module.exports = {
    /**
     * 极简 EVM 签名策略（先写死在代码里，后续可改为从文件/DB/远端配置读取）
     *
     * 设计目标：
     * - 默认拒绝高风险操作（尤其是 approve / 原生币转账）
     * - 只允许你明确列出的链、合约、方法
     *
     * 本文件内容已对齐 `../astro-core` 当前的 OKXDEX 交易路径：
     * - chainIndex: 1 (ETH), 56 (BNB), 42161 (ARB), 8453 (BASE)
     * - approve: ERC20 approve(spender, amount)（spender 为 OKX Token Approval 合约）
     * - swap: 调用 OKX DEX Router（/swap API 返回 tx.to 与 tx.data）
     *
     * 参考：
     * - OKX DEX Router/Approval 地址与 ABI 文档：
     *   `https://web3.okx.com/build/dev-docs/wallet-api/dex-smart-contract`
     */

    // 允许的链（必须非空；为空会拒绝签名，避免“忘配导致全放开”）
    allowedChainIds: [
        1,     // Ethereum
        56,    // BNB Chain (BSC)
        42161, // Arbitrum One
        8453,  // Base
    ],

    // 允许的 to 地址（必须非空；为空会拒绝签名）
    // 统一用小写。
    allowedTo: [
        // OKX DEX Router (Ethereum)
        '0x5e1f62dac767b0491e3ce72469c217365d5b48cc',

        // OKX DEX Router (Arbitrum)
        '0x368e01160c2244b0363a35b3ff0a971e44a89284',

        // OKX DEX Router (Base)
        '0x4409921ae43a39a11d90f7b7f96cfd0b8093d9fc',

        // OKX DEX Router (BNB Chain)
        '0x3156020dff8d99af1ddc523ebdfb1ad2018554a0',

        // OKX DEX Router used in exactOut transactions (Ethereum)
        // https://web3.okx.com/build/dev-docs/wallet-api/dex-smart-contract
        '0xa875fb2204ce71679be054d97f7faffeb6536d67',

        // OKX DEX Router used in exactOut transactions (Arbitrum)
        // https://web3.okx.com/build/dev-docs/wallet-api/dex-smart-contract
        '0x9736d9a45115e33411390ebd54e5a5c3a6e25aa6',

        // OKX DEX Router used in exactOut transactions (Base)
        // https://web3.okx.com/build/dev-docs/wallet-api/dex-smart-contract
        '0x77449ff075c0a385796da0762bcb46fd5cc884c6',

        // OKX DEX Router used in exactOut transactions (BNB Chain)
        // https://web3.okx.com/build/dev-docs/wallet-api/dex-smart-contract
        '0x5cb43bae4f36e2f9f858232b4dce0dbe27bb85e3',

        // OKX Token Approval contract (Ethereum) - may appear as tx.to in some flows
        // https://web3.okx.com/build/dev-docs/wallet-api/dex-smart-contract
        '0x40aa958dd87fc8305b97f2ba922cddca374bcd7f',

        // OKX Token Approval contract (Arbitrum) - may appear as tx.to in some flows
        // https://web3.okx.com/build/dev-docs/wallet-api/dex-smart-contract
        '0x70cbb871e8f30fc8ce23609e9e0ea87b6b222f58',

        // OKX Token Approval contract (Base) - may appear as tx.to in some flows
        // https://web3.okx.com/build/dev-docs/wallet-api/dex-smart-contract
        '0x57df6092665eb6058de53939612413ff4b09114e',

        // OKX Token Approval contract (BNB Chain) - may appear as tx.to in some flows
        // https://web3.okx.com/build/dev-docs/wallet-api/dex-smart-contract
        '0x2c34a2fb1d0b4f55de51e1d0bdefaddce6b7cdd6',
    ],

    /**
     * 允许的 4-byte method selector（必须非空；为空会拒绝签名）
     * - data === '0x'（无 selector）一般代表原生币转账或 fallback call，默认禁止。
     * - ERC20 approve 的 selector 固定为 0x095ea7b3（默认在代码里额外严格控制）
     */
    allowedMethodSelectors: [
        // ERC20 approve(address,uint256)
        '0x095ea7b3',

        // OKX TokenApproveProxy claimTokens(address,address,address,uint256)
        // (If user calls it directly it should revert unless msg.sender is allowed proxy,
        // but allowlisting it avoids breaking OKX flows if they require it in user tx.)
        '0x0a5ea466',

        // OKX DEX Router (DexRouter.json) - swap API 常见入口（按 ABI 计算得到的 selector）
        // 注意：不包含 callback（例如 uniswapV3SwapCallback），避免扩大攻击面
        '0x01617fab', // swapWrap(uint256,uint256)
        '0x03b87e5f', // smartSwapTo(uint256,address,(...),uint256[],(...)[][],(...)[])
        '0x08298b5a', // unxswapTo(uint256,uint256,uint256,address,bytes32[])
        '0x0d5f0e3b', // uniswapV3SwapTo(uint256,uint256,uint256,uint256[])
        '0x44014e98', // uniswapV3SwapToWithBaseRequest(uint256,address,(...),uint256[])
        '0x591b3d08', // smartSwapByInvestWithRefund((...),uint256[],(...)[][],(...)[],address,address)
        '0x9871efa4', // unxswapByOrderId(uint256,uint256,uint256,bytes32[])
        '0x98d2ac62', // swapWrapToWithBaseRequest(uint256,address,(...))
        '0xb80c2f09', // smartSwapByOrderId(uint256,(...),uint256[],(...)[][],(...)[])
        '0xb8815477', // unxswapToWithBaseRequest(uint256,address,(...),bytes32[])
        '0xf2c42696', // dagSwapByOrderId(uint256,(...), (address[],address[],uint256[],bytes[],uint256)[])  (OKX router, observed in logs)
        '0xe99bfa95', // smartSwapByInvest((...),uint256[],(...)[][],(...)[],address)
    ],

    // 是否允许 data === '0x' 的交易（通常代表原生币转账/EOA 转账）
    allowEmptyData: false,

    // 允许的最大 value（wei）。0n 表示禁止携带任何原生币转账。
    maxValueWei: 0n,

    // ERC20 approve 的特殊控制（强烈建议默认禁用，或仅允许固定 spender + 限额）
    approve: {
        // astro-core 在 quote/base allowance 不足时会 approve 大额度（MaxUint256）
        enabled: true,
        spenderAllowlist: [
            // OKX Token Approval contract (Ethereum) from OKX docs
            // https://web3.okx.com/build/dev-docs/wallet-api/dex-smart-contract
            '0x40aa958dd87fc8305b97f2ba922cddca374bcd7f',

            // OKX Token Approval contract (Arbitrum) from OKX docs
            // https://web3.okx.com/build/dev-docs/wallet-api/dex-smart-contract
            '0x70cbb871e8f30fc8ce23609e9e0ea87b6b222f58',

            // OKX Token Approval contract (Base) from OKX docs
            // https://web3.okx.com/build/dev-docs/wallet-api/dex-smart-contract
            '0x57df6092665eb6058de53939612413ff4b09114e',

            // OKX Token Approval contract (BNB Chain) from OKX docs
            // https://web3.okx.com/build/dev-docs/wallet-api/dex-smart-contract
            '0x2c34a2fb1d0b4f55de51e1d0bdefaddce6b7cdd6',
        ],
        // 最大可授权额度（wei/uint256）。enabled=true 时生效。
        // 允许 MaxUint256（与 astro-core 行为一致）
        maxAmount: (2n ** 256n) - 1n,
    },
};
