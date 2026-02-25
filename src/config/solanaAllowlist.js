module.exports = {
    /**
     * Solana 签名策略（与 evmAllowlist 设计一致，参考 taoli-tools-signer）
     *
     * 设计目标：
     * - 默认仅允许 OKX DEX swap 等明确场景
     * - 与 astro-core 的 OKXDEX Solana 交易路径对齐（chainIndex: 501）
     * - 仅允许白名单内的程序被调用，防止恶意交易
     *
     * 参考：
     * - https://github.com/taoli-tools/taoli-tools-signer
     * - https://web3.okx.com/build/dev-docs/wallet-api/dex-smart-contract
     * - https://dev.jup.ag/get-started/index#programs
     */

    // 是否启用 Solana 签名
    enabled: true,

    // 允许的最大交易数据大小（bytes），防止异常大 payload
    maxTxDataSize: 1280, // Solana PACKET_DATA_SIZE

    /**
     * 允许调用的程序 ID 白名单（base58）
     * 交易中每个 instruction 的 programId 必须在此列表中
     */
    allowedProgramIds: [
        // 系统程序
        '11111111111111111111111111111111', // System Program
        'ComputeBudget111111111111111111111111111111', // Compute Budget (legacy)
        'ComputeBudget11111111111111111111111111111111', // Compute Budget Program

        // 代币相关
        // 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // token
        // 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', // token-2022
        'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', // Associated Token Program

        // OKX DEX Router (Solana)
        // https://web3.okx.com/build/dev-docs/wallet-api/dex-smart-contract
        'proVF4pMXVaYqmy4NjniPh4pqKNfMmsihgd4wdkCX3u',

        // Jupiter Aggregator（如需支持 Jupiter 可取消注释）
        // https://dev.jup.ag/get-started/index#programs
        // 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
    ],
};
