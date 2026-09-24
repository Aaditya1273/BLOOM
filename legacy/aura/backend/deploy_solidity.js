const fs = require('fs');
const solc = require('solc');
const { ethers } = require('ethers');

async function main() {
    const source = fs.readFileSync('Escrow.sol', 'utf8');

    const input = {
        language: 'Solidity',
        sources: {
            'Escrow.sol': {
                content: source,
            },
        },
        settings: {
            outputSelection: {
                '*': {
                    '*': ['*'],
                },
            },
            optimizer: { enabled: true, runs: 200 }
        },
    };

    console.log("Compiling...");
    const output = JSON.parse(solc.compile(JSON.stringify(input)));
    
    if (output.errors) {
        output.errors.forEach(err => console.error(err.formattedMessage));
        if (output.errors.some(err => err.severity === 'error')) {
            process.exit(1);
        }
    }

    const contract = output.contracts['Escrow.sol']['AuraCrossChainEscrow'];
    const bytecode = contract.evm.bytecode.object;
    const abi = contract.abi;

    const provider = new ethers.JsonRpcProvider('https://sepolia-rollup.arbitrum.io/rpc');
    const privateKey = process.env.PRIVATE_KEY;
    const wallet = new ethers.Wallet(privateKey, provider);

    console.log("Deploying Solidity Escrow...");
    const factory = new ethers.ContractFactory(abi, bytecode, wallet);
    const escrow = await factory.deploy();
    await escrow.waitForDeployment();
    const address = await escrow.getAddress();
    console.log("Escrow deployed to:", address);

    console.log("Initializing Escrow...");
    let tx = await escrow.init(
        '0x27cd6ed9482ff6ae388f629e8e6d57d8dc975c5a', 
        '0x3346abe000118b25aca953f48deb1978a069e7de', 
        '0x0a041e6395bf1291ab06fa1bbe16462686af0d55'
    );
    await tx.wait();
    console.log("Initialized!");

    console.log("Updating OrderBook router...");
    const orderbookAbi = ["function set_router(address router) external"];
    const obContract = new ethers.Contract('0x3346abe000118b25aca953f48deb1978a069e7de', orderbookAbi, wallet);
    tx = await obContract.set_router(address);
    await tx.wait();
    console.log("OrderBook Router updated to:", address);

    const envPath = '.env';
    let envContent = fs.readFileSync(envPath, 'utf8');
    envContent = envContent.replace(/^ESCROW_ADDRESS=.*$/m, "ESCROW_ADDRESS=" + address);
    fs.writeFileSync(envPath, envContent);
    console.log("Updated backend/.env");
    fs.writeFileSync('NEW_ESCROW_ADDRESS.txt', address);
}
main().catch(console.error);
