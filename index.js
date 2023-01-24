import { BigNumber, ethers } from "ethers"
import * as dotenv from 'dotenv'
import { default as disperseABI } from './disperseAbi.json' assert {type: "json"}
import { default as erc20Abi } from './erc20ABI.json' assert {type: "json"}
import Bluebird from "bluebird"
dotenv.config()

// check rpc
const rpc = process.env.OP_RPC

// const mnemonic2 = process.env.PROFILE_2
// const mnemonic3 = process.env.PROFILE_3
const mnemonic1 = process.env.PROFILE_1

// check feeder acc
const feederAccount = process.env.FEEDER_ACCOUNT

// check token address
let tokenAddress = process.env.TOKEN_ADDRESS
let disperseContract = process.env.DISPERSE_CONTRACT_ADDRESS
let receiverAddress = process.env.RECEIVER_ADDRESS  // check receiver address

let mnemonics = [mnemonic1]

let provider = new ethers.providers.JsonRpcProvider(rpc)

// wallet to be used for refueling
const feederWallet = new ethers.Wallet(feederAccount, provider)


const fetchPerGasFees = async (provider) => {
    let { maxPriorityFeePerGas, maxFeePerGas, lastBaseFeePerGas } = await provider.getFeeData()
    let maxPerGas = maxPriorityFeePerGas.add(maxFeePerGas)
    let estimatedPerGas = maxPriorityFeePerGas.add(lastBaseFeePerGas)
    return { maxPerGas, estimatedPerGas }
}

// gas estimation
const estimateGas = async (provider, gasUnits) => {
    let { gasPrice } = await provider.getFeeData()
    let gasRequired = gasPrice.mul(gasUnits) // check gas units required for token transfer
    return gasRequired
}

// checks gas needed for token transfer after deducting current balance
const checkRefuelNeeded = async (wallet, gasUnits) => {
    let bal = await wallet.getBalance()
    let gasRequired = await estimateGas(provider, gasUnits)
    if (bal.gt(gasRequired)) {
        return {
            status: false,
            amount: 0
        }
    }
    let gasToSend = gasRequired.sub(bal)
    return {
        status: true,
        amount: gasToSend
    }
}

// balance check and filter wallets
const tokenBalanceCheck = async (acc, curWallet) => {
    try {
        let contract = new ethers.Contract(tokenAddress, erc20Abi, provider)
        let bal = await contract.balanceOf(curWallet.address)
        if (Number(ethers.utils.formatEther(bal))) {
            acc.walletsWithToken.push(curWallet)
            console.log(ethers.utils.formatEther(acc.total.add(bal)))
        }
        return { walletsWithToken: acc.walletsWithToken,total:acc.total.add(bal)}
    } catch (error) {
        console.log(error)
    }
}

// disperse
const disperseEth = async (addresses, amounts) => {
    try {
        let contract = new ethers.Contract(disperseContract, disperseABI, feederWallet)
        let total = amounts.reduce((acc, cur) => acc.add(cur), BigNumber.from(0))
        let { gasPrice } = await provider.getFeeData()

        let receipt = await contract.disperseEther(addresses, amounts, { value: total, gasPrice })
        return receipt
    } catch (error) {
        console.log(error)
    }
}



// reverse disperse
const reverseDisperse = async (wallet) => {
    try {
        let contract = new ethers.Contract(tokenAddress, erc20Abi, wallet)
        let bal = await contract.balanceOf(wallet.address)
        let { gasPrice } = await provider.getFeeData()
        if (Number(ethers.utils.formatEther(bal))) {
            let receipt = await contract.transfer(receiverAddress, bal, { gasLimit: 64651, gasPrice })
            return receipt
        }
        return
    } catch (error) {
        console.log(error)
    }
}

// initialize
const init = async () => {

    let walletsToCheck = []
    let walletsWithToken = []

    mnemonics.forEach(m => {
        Array.from(Array(11), (_, i) => {
            let wallet = new ethers.Wallet.fromMnemonic(m, `m/44'/60'/0'/0/${i}`)
            let walletWithProvider = wallet.connect(provider)
            walletsToCheck.push(walletWithProvider)
        })
    })

    // reverse disperse with disperse of gas for accounts with not enough gas to send token
    Bluebird.reduce(walletsToCheck, tokenBalanceCheck, { walletsWithToken, total: BigNumber.from(0) })
        .then(async ({walletsWithToken}) => {
            console.log(walletsWithToken.length)
            Bluebird.map(walletsWithToken, reverseDisperse, { concurrency: 5 }).then(console.log)

            // if (walletsWithToken.length == 0) {
            //     return
            // } else if (walletsWithToken.length == 1) {  // don't disperse if only 1 wallet
            //     let refuel = await checkRefuelNeeded(walletsWithToken[0], 41000)
            //     if (refuel.status) {
            //         let { gasPrice } = await provider.getFeeData()
            //         let refuelReceipt = await feederWallet.sendTransaction({ to: walletsWithToken[0].address, value: refuel.amount, gasLimit: 21000, gasPrice })
            //     }
            //     let receipt = await reverseDisperse(walletsWithToken[0])
            //     console.log(receipt)
            //     return
            // }
            // let addresses = walletsWithToken.map(w => w.address)

            // let amounts = []
            // walletsWithToken.forEach(async (wallet, i) => {
            //     let refuel = await checkRefuelNeeded(wallet, 41000)
            //     if (!refuel.status) {
            //         addresses.splice(i, 1)
            //         return
            //     }
            //     amounts.push(refuel.amount)
            //     return
            // })
            // let receipt = await disperseEth(addresses, amounts)
            // console.log(receipt)
        })
        // .then(() => {
        //     if (walletsWithToken.length <= 1) return
        //     Bluebird.map(walletsWithToken, reverseDisperse, { concurrency: 5 }).then(console.log)
        // })
}

init()