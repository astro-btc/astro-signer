const express = require('express');
const { ethers } = require('ethers');
const crypto = require('crypto');
const bip39 = require('bip39');
const { derivePath } = require('ed25519-hd-key');
const { Keypair, VersionedTransaction, Transaction } = require('@solana/web3.js');
const bs58 = require('bs58');
const { limiters } = require('../middlewares/rateLimiter');
const ipv4Allowlist = require('../middlewares/ipv4Allowlist');
const remoteSignerAuth = require('../middlewares/remoteSignerAuth');
const evmAllowlist = require('../config/evmAllowlist');
const solanaAllowlist = require('../config/solanaAllowlist');

const router = express.Router();

const badReq = (message) => Object.assign(new Error(message), { status: 400 });
const misconfig = (message) => Object.assign(new Error(message), { status: 500 });

function selectorOf(data) {
    if (typeof data !== 'string') return '';
    const s = data.toLowerCase();
    if (!s.startsWith('0x')) return '';
    if (s.length < 10) return '0x';
    return s.slice(0, 10);
}

function safeStr(v, maxLen = 256) {
    const s = v == null ? '' : String(v);
    return s.length > maxLen ? (s.slice(0, maxLen) + '…') : s;
}

function logSign(event, req, extra) {
    // Structured log for forensics; avoid logging full calldata or secrets
    try {
        console.log(JSON.stringify({
            event,
            requestId: req.requestId,
            ip: req.ip,
            method: req.method,
            path: req.originalUrl,
            ua: safeStr(req.headers['user-agent'] || '', 128),
            remoteSigner: req.remoteSigner || undefined, // ts/nonce/bodySha256 (added by middleware)
            ...extra,
        }));
    } catch {
        // ignore
    }
}

function normalizeMnemonic(raw) {
    if (!raw) return '';
    let s = String(raw).trim();
    // allow MNEMONIC="a b c" in .env
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1).trim();
    return s;
}

let cachedWallet = null;
function getEvmWallet() {
    if (cachedWallet) return cachedWallet;
    const mnemonic = normalizeMnemonic(process.env.MNEMONIC);
    if (!mnemonic) throw new Error('MNEMONIC missing');
    const Wallet = ethers.Wallet;
    cachedWallet = (Wallet && typeof Wallet.fromPhrase === 'function')
        ? Wallet.fromPhrase(mnemonic)
        : Wallet.fromMnemonic(mnemonic);
    return cachedWallet;
}

let cachedSolanaKeypair = null;
function getSolanaKeypair() {
    if (cachedSolanaKeypair) return cachedSolanaKeypair;
    const mnemonic = normalizeMnemonic(process.env.MNEMONIC);
    if (!mnemonic) throw new Error('MNEMONIC missing');
    if (!bip39.validateMnemonic(mnemonic)) throw new Error('Invalid mnemonic');
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    const derived = derivePath("m/44'/501'/0'/0'", seed.toString('hex'));
    cachedSolanaKeypair = Keypair.fromSeed(derived.key);
    return cachedSolanaKeypair;
}

function toInt(v, name, { min = 0, required = false } = {}) {
    if (v == null) {
        if (required) throw badReq(`Missing ${name}`);
        return null;
    }
    const n = typeof v === 'number' ? v : Number(String(v));
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < min) throw badReq(`Invalid ${name}`);
    return n;
}

function toBig(v, name, { min = 0n, required = false } = {}) {
    if (v == null) {
        if (required) throw badReq(`Missing ${name}`);
        return null;
    }
    try {
        const bi = typeof v === 'bigint' ? v : BigInt(typeof v === 'number' ? Math.trunc(v) : String(v).trim());
        if (bi < min) throw badReq(`Invalid ${name}`);
        return bi;
    } catch {
        throw badReq(`Invalid ${name}`);
    }
}

function buildEvmTx(txIn) {
    if (!txIn || typeof txIn !== 'object') throw badReq('Bad tx params');

    const chainId = toInt(txIn.chainId, 'chainId', { min: 1, required: true });
    const nonce = toInt(txIn.nonce, 'nonce', { min: 0, required: true });

    const to = String(txIn.to || '').trim();
    if (!ethers.isAddress(to)) throw badReq('Invalid to');

    const data = txIn.data == null ? '0x' : String(txIn.data);
    if (!ethers.isHexString(data)) throw badReq('Invalid data');

    const gasLimit = toBig(txIn.gasLimit, 'gasLimit', { min: 1n, required: true });
    const value = toBig(txIn.value ?? 0, 'value', { min: 0n }) ?? 0n;
    const type = txIn.type == null ? undefined : toInt(txIn.type, 'type', { min: 0, required: true });

    const has1559 = txIn.maxFeePerGas != null || txIn.maxPriorityFeePerGas != null;
    if (has1559) {
        const maxFeePerGas = toBig(txIn.maxFeePerGas, 'maxFeePerGas', { min: 1n, required: true });
        const maxPriorityFeePerGas = toBig(txIn.maxPriorityFeePerGas, 'maxPriorityFeePerGas', { min: 0n, required: true });
        return {
            chainId,
            type: type ?? 2,
            to,
            data,
            nonce,
            value,
            gasLimit,
            maxFeePerGas,
            maxPriorityFeePerGas,
        };
    }

    const gasPrice = toBig(txIn.gasPrice, 'gasPrice', { min: 1n, required: true });
    return {
        chainId,
        type: type ?? 0,
        to,
        data,
        nonce,
        value,
        gasLimit,
        gasPrice,
    };
}

function mustNonEmptyArray(v, name) {
    if (!Array.isArray(v) || v.length === 0) throw misconfig(`EVM allowlist misconfigured: ${name} is empty`);
    return v;
}

function enforceEvmAllowlist(tx) {
    const chainId = Number(tx.chainId);
    const allowedChainIds = mustNonEmptyArray(evmAllowlist.allowedChainIds, 'allowedChainIds');
    if (!allowedChainIds.includes(chainId)) throw badReq('chainId not allowed');

    const value = typeof tx.value === 'bigint' ? tx.value : BigInt(tx.value ?? 0);
    const maxValue = typeof evmAllowlist.maxValueWei === 'bigint' ? evmAllowlist.maxValueWei : BigInt(evmAllowlist.maxValueWei ?? 0);
    if (value > maxValue) throw badReq('value not allowed');

    const data = (tx.data == null ? '0x' : String(tx.data)).toLowerCase();
    if (data === '0x' || data === '0x0') {
        if (!evmAllowlist.allowEmptyData) throw badReq('empty data not allowed');
        return;
    }

    const sel = selectorOf(data);
    const allowSelectors = mustNonEmptyArray(evmAllowlist.allowedMethodSelectors, 'allowedMethodSelectors')
        .map((x) => String(x).toLowerCase());
    if (!allowSelectors.includes(sel)) throw badReq(`method not allowed: to=${String(tx.to).toLowerCase()} selector=${sel}`);

    // Special case: ERC20 approve(address,uint256) selector 0x095ea7b3
    if (sel === '0x095ea7b3') {
        const approveCfg = evmAllowlist.approve || {};
        if (!approveCfg.enabled) throw badReq('approve not allowed');

        let spender, amount;
        try {
            const iface = new ethers.Interface(['function approve(address spender,uint256 amount)']);
            const decoded = iface.decodeFunctionData('approve', data);
            spender = decoded?.spender;
            amount = decoded?.amount;
        } catch {
            throw badReq('invalid approve data');
        }

        const spenderAllowlist = mustNonEmptyArray(approveCfg.spenderAllowlist, 'approve.spenderAllowlist')
            .map((x) => String(x).toLowerCase());
        if (!spenderAllowlist.includes(String(spender || '').toLowerCase())) throw badReq('approve spender not allowed');

        const maxAmount = typeof approveCfg.maxAmount === 'bigint' ? approveCfg.maxAmount : BigInt(approveCfg.maxAmount ?? 0);
        const amt = typeof amount === 'bigint' ? amount : BigInt(amount ?? 0);
        if (amt > maxAmount) throw badReq('approve amount not allowed');
        // NOTE: approve 的 tx.to 是 token 合约地址（币种经常变动），这里不做 token allowlist。
        return;
    }

    // Non-approve calls must go to allowlisted routers/contracts.
    const allowedTo = mustNonEmptyArray(evmAllowlist.allowedTo, 'allowedTo')
        .map((x) => String(x).toLowerCase());
    if (!allowedTo.includes(String(tx.to).toLowerCase())) throw badReq(`to not allowed: ${String(tx.to).toLowerCase()}`);
}

function decodeSolanaTxData(txData) {
    try {
        return Buffer.from(bs58.decode(txData));
    } catch {
        return Buffer.from(txData, 'base64');
    }
}

function enforceSolanaAllowlist(txData) {
    if (!solanaAllowlist.enabled) throw badReq('Solana signing disabled');
    const maxSize = solanaAllowlist.maxTxDataSize ?? 1280;
    const buf = decodeSolanaTxData(txData);
    if (buf.length > maxSize) throw badReq(`txData too large: ${buf.length} > ${maxSize}`);
    if (buf.length < 64) throw badReq('txData too short');
}

function getSolanaProgramIdsFromTx(tx) {
    const programIds = new Set();
    if (tx.instructions) {
        // Legacy Transaction
        for (const ix of tx.instructions) {
            if (ix.programId) programIds.add(ix.programId.toBase58());
        }
        return programIds;
    }
    // VersionedTransaction (Message 或 MessageV0 均有 staticAccountKeys + compiledInstructions)
    const msg = tx.message;
    const staticKeys = msg.staticAccountKeys || msg.accountKeys || [];
    const compiledIxs = msg.compiledInstructions || [];
    for (const ix of compiledIxs) {
        const idx = ix.programIdIndex;
        if (idx >= staticKeys.length) {
            throw badReq('Transaction uses address lookup table; program ID cannot be verified');
        }
        programIds.add(staticKeys[idx].toBase58());
    }
    return programIds;
}

function enforceSolanaProgramAllowlist(tx) {
    const allowed = solanaAllowlist.allowedProgramIds;
    if (!Array.isArray(allowed) || allowed.length === 0) return;
    const allowSet = new Set(allowed.map((id) => String(id).trim()).filter(Boolean));
    const programIds = getSolanaProgramIdsFromTx(tx);
    for (const pid of programIds) {
        if (!allowSet.has(pid)) throw badReq(`Forbidden program: ${pid}`);
    }
}

function validateSignSchema(req, res, next) {
    const body = req.body || {};
    if (!body || typeof body !== 'object') return res.status(400).json({ code: -1, data: 'bad body' });

    const signType = body.signType;
    if (signType !== 'evm' && signType !== 'solana') return res.status(400).json({ code: -1, data: 'bad signType param' });

    const payload = body.payload ?? body.data ?? body.rawData;
    if (!payload || typeof payload !== 'object') return res.status(400).json({ code: -1, data: 'bad rawData param' });

    req.signType = signType;
    req.signPayload = payload;
    return next();
}

async function signEvm(payload) {
    if (!payload || typeof payload !== 'object') throw badReq('bad rawData param');
    const wallet = getEvmWallet();

    // { tx:{...}, from }
    const from = payload.from ? String(payload.from).toLowerCase() : '';
    if (from && from !== wallet.address.toLowerCase()) throw badReq(`from mismatch: req=${from}, signer=${wallet.address.toLowerCase()}`);

    const txObj = buildEvmTx(payload.tx || payload);
    enforceEvmAllowlist(txObj);
    const signedTx = await wallet.signTransaction(txObj);
    const txHash = ethers.keccak256(signedTx);
    return { signedTx, txHash, from: wallet.address };
}

async function signSolana(payload) {
    if (!payload || typeof payload !== 'object') throw badReq('bad rawData param');
    const keypair = getSolanaKeypair();
    const from = payload.from ? String(payload.from).trim() : '';
    const txData = payload.txData ?? payload.tx?.data ?? payload.data;
    if (!txData || typeof txData !== 'string') throw badReq('Missing txData for Solana');

    enforceSolanaAllowlist(txData);
    if (from && from !== keypair.publicKey.toBase58()) throw badReq(`from mismatch: req=${from}, signer=${keypair.publicKey.toBase58()}`);

    const txBuf = decodeSolanaTxData(txData);
    let tx;
    try {
        tx = VersionedTransaction.deserialize(txBuf);
    } catch {
        try {
            tx = Transaction.from(txBuf);
        } catch (e) {
            throw badReq(`Invalid Solana txData: ${e?.message || 'deserialize failed'}`);
        }
    }

    enforceSolanaProgramAllowlist(tx);
    tx.sign([keypair]);
    const serialized = tx.serialize();
    const signedTx = Buffer.from(serialized).toString('base64');
    const firstSig = tx.signatures?.[0];
    const txHash = firstSig
        ? bs58.encode(Buffer.from(firstSig.signature ?? firstSig))
        : null;
    return { signedTx, txHash, from: keypair.publicKey.toBase58() };
}

router.post('/', limiters.api, ipv4Allowlist, remoteSignerAuth, validateSignSchema, async (req, res) => {
    const startMs = Date.now();
    const p = req.signPayload;
    const signType = req.signType;

    if (signType === 'evm') {
        const tx = p?.tx && typeof p.tx === 'object' ? p.tx : p;
        const to = tx?.to ? String(tx.to).toLowerCase() : '';
        const fromReq = p?.from ? String(p.from).toLowerCase() : '';
        const chainId = tx?.chainId;
        const sel = selectorOf(tx?.data == null ? '0x' : String(tx.data));
        const dataLen = tx?.data == null ? 0 : String(tx.data).length;
        logSign('sign_request', req, {
            signType: 'evm',
            chainId,
            fromReq,
            to,
            selector: sel,
            tx: {
                nonce: tx?.nonce,
                type: tx?.type,
                value: tx?.value,
                gasLimit: tx?.gasLimit,
                gasPrice: tx?.gasPrice,
                maxFeePerGas: tx?.maxFeePerGas,
                maxPriorityFeePerGas: tx?.maxPriorityFeePerGas,
                dataLen,
            },
        });
    } else {
        const txData = p?.txData ?? p?.tx?.data ?? p?.data;
        logSign('sign_request', req, {
            signType: 'solana',
            fromReq: p?.from ? safeStr(p.from, 64) : '',
            txDataLen: txData ? String(txData).length : 0,
        });
    }

    try {
        const data = signType === 'solana'
            ? await signSolana(req.signPayload)
            : await signEvm(req.signPayload);
        logSign('sign_ok', req, {
            durationMs: Date.now() - startMs,
            signType,
            signer: safeStr(data?.from || '', 64),
            txHash: safeStr(data?.txHash || '', 80),
        });
        return res.status(200).json({ code: 0, data });
    } catch (e) {
        const status = Number.isInteger(e?.status) ? e.status : 500;
        logSign('sign_failed', req, {
            durationMs: Date.now() - startMs,
            signType,
            status,
            message: safeStr(e?.message || 'unknown', 300),
        });
        return res.status(status).json({ code: -1, data: e?.message || 'Internal Server Error' });
    }
});

module.exports = router;
