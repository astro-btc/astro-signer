const express = require('express');
const router = express.Router();
const { ethers } = require('ethers');
const bip39 = require('bip39');
const { derivePath } = require('ed25519-hd-key');
const { Keypair } = require('@solana/web3.js');
const { limiters } = require('../middlewares/rateLimiter');
const ipv4Allowlist = require('../middlewares/ipv4Allowlist');
const remoteSignerAuth = require('../middlewares/remoteSignerAuth');
const packageJSON = require('../../package.json')

function parseAllowlist(raw) {
    if (!raw) return [];
    return raw
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
}

function normalizeMnemonic(raw) {
    if (!raw) return '';
    let s = String(raw).trim();
    // allow MNEMONIC="a b c" in .env
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
        s = s.slice(1, -1).trim();
    }
    return s;
}

function maskAddress(addr, head, tail) {
    if (!addr || typeof addr !== 'string') return '';
    const s = addr.trim();
    if (!s) return '';
    const h = Number.isFinite(head) ? head : 6;
    const t = Number.isFinite(tail) ? tail : 4;
    // too short => don't mask
    if (s.length <= h + t + 3) return s;
    return `${s.slice(0, h)}...${s.slice(-t)}`;
}

let cachedEvmAddress = null;
async function getEvmAddressFromMnemonic() {
    if (cachedEvmAddress) return cachedEvmAddress;
    const mnemonic = normalizeMnemonic(process.env.MNEMONIC);
    if (!mnemonic) return '';

    const Wallet = ethers.Wallet;
    const wallet = (Wallet && typeof Wallet.fromPhrase === 'function')
        ? Wallet.fromPhrase(mnemonic)
        : Wallet.fromMnemonic(mnemonic);
    cachedEvmAddress = wallet.address;
    return cachedEvmAddress;
}

let cachedSolAddress = null;
function getSolAddressFromMnemonic() {
    if (cachedSolAddress) return cachedSolAddress;
    const mnemonic = normalizeMnemonic(process.env.MNEMONIC);
    if (!mnemonic) return '';
    if (!bip39.validateMnemonic(mnemonic)) return '';

    // Standard Solana derivation path (BIP44): m/44'/501'/0'/0'
    const seed = bip39.mnemonicToSeedSync(mnemonic); // Buffer(64)
    const derived = derivePath("m/44'/501'/0'/0'", seed.toString('hex'));
    const keypair = Keypair.fromSeed(derived.key); // expects 32 bytes
    cachedSolAddress = keypair.publicKey.toBase58();
    return cachedSolAddress;
}

router.get('/', limiters.strict, async (req, res) => {
    let ipv4WhiteList = true
    const allow = parseAllowlist(process.env.IPV4_WHITE_LIST);
    if (allow.length === 0) {
        ipv4WhiteList = false
    }

    let evmAddress, solAddress
    try {
        // 通过 process.env.MNEMONIC 获取其 evm 地址（ethers）
        evmAddress = await getEvmAddressFromMnemonic();
        // 通过 process.env.MNEMONIC 获取其 sol 地址（solana）
        try {
            solAddress = getSolAddressFromMnemonic();
        } catch {
            solAddress = '';
        }
    } catch (err) {
        const obj = {
            error: err?.shortMessage || err?.message || 'Unknown error'
        }
        return res.type('application/json; charset=utf-8').send(JSON.stringify(obj, null, 2))
    }

    const obj = {
        evmAddress: maskAddress(evmAddress, 6, 4), // 常见展示：0x1234...abcd
        solAddress: maskAddress(solAddress, 4, 4), // 常见展示：Abcd...Wxyz
        ipv4WhiteList,
        version: packageJSON.version
    }
    // 这里必须显式设置为 JSON；否则浏览器会按 text/html 渲染并折叠空白，看起来像“没格式化”
    res.type('application/json; charset=utf-8').send(JSON.stringify(obj, null, 2))
});

router.get('/full-address', limiters.api, ipv4Allowlist, remoteSignerAuth, async (req, res) => {
    let ipv4WhiteList = true
    const allow = parseAllowlist(process.env.IPV4_WHITE_LIST);
    if (allow.length === 0) {
        ipv4WhiteList = false
    }

    let evmAddress, solAddress
    try {
        // 通过 process.env.MNEMONIC 获取其 evm 地址（ethers）
        evmAddress = await getEvmAddressFromMnemonic();
        // 通过 process.env.MNEMONIC 获取其 sol 地址（solana）
        try {
            solAddress = getSolAddressFromMnemonic();
        } catch {
            solAddress = '';
        }
    } catch (err) {
        const obj = {
            error: err?.shortMessage || err?.message || 'Unknown error'
        }
        return res.type('application/json; charset=utf-8').send(JSON.stringify(obj, null, 2))
    }

    const obj = {
        evmAddress,
        solAddress,
        ipv4WhiteList,
        version: packageJSON.version
    }
    // 这里必须显式设置为 JSON；否则浏览器会按 text/html 渲染并折叠空白，看起来像“没格式化”
    res.type('application/json; charset=utf-8').send(JSON.stringify(obj, null, 2))
});

module.exports = router;
