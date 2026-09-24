const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Aura System", function () {
  let auraAccount;
  let guardrailManager;
  let owner;
  let aiAgent;
  let otherAccount;
  let mockDapp;

  let paymaster;

  beforeEach(async function () {
    [owner, aiAgent, otherAccount] = await ethers.getSigners();

    // Deploy Real EntryPoint
    const EntryPoint = await ethers.getContractFactory("EntryPoint", owner);
    const entryPoint = await EntryPoint.deploy();
    const entryPointAddress = entryPoint.target;

    // Deploy GuardrailManager
    const GuardrailManager = await ethers.getContractFactory("AuraGuardrailManager", owner);
    guardrailManager = await GuardrailManager.deploy(owner.address);

    // Deploy AuraAccount implementation
    const AuraAccount = await ethers.getContractFactory("AuraAccount", owner);
    const implementation = await AuraAccount.deploy(entryPointAddress);

    // Deploy Proxy
    const ERC1967Proxy = await ethers.getContractFactory("@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy", owner);
    const initData = implementation.interface.encodeFunctionData("initialize", [owner.address]);
    const proxy = await ERC1967Proxy.deploy(implementation.target, initData);
    auraAccount = AuraAccount.attach(proxy.target);

    // Deploy Paymaster
    const AuraPaymaster = await ethers.getContractFactory("AuraPaymaster", owner);
    paymaster = await AuraPaymaster.deploy(entryPointAddress, owner.address);

    // Deploy MockDapp
    const MockDapp = await ethers.getContractFactory("MockDapp", owner);
    mockDapp = await MockDapp.deploy();

    await auraAccount.setAiAgent(aiAgent.address);
    await auraAccount.setGuardrail(guardrailManager.target);
  });

  it("Should correctly deploy and configure the Paymaster", async function () {
    expect(await paymaster.verifier()).to.equal(owner.address);
  });

  it("Should allow owner to execute anything", async function () {
    const dest = mockDapp.target;
    const value = 0;
    const data = "0x";
    
    await expect(auraAccount.connect(owner).execute(dest, value, data))
      .to.not.be.reverted;
  });

  it("Should allow AI Agent to execute if whitelisted", async function () {
    const dest = mockDapp.target;
    const value = ethers.parseEther("0.1");
    const data = mockDapp.interface.encodeFunctionData("testCall");

    // Whitelist destination and selector
    await guardrailManager.toggleDestination(dest, true);
    await guardrailManager.toggleSelector(dest, data.substring(0, 10), true);

    // Fund account
    await owner.sendTransaction({ to: auraAccount.target, value: ethers.parseEther("1") });

    await expect(auraAccount.connect(aiAgent).executeByAgent(dest, value, data))
      .to.emit(mockDapp, "Called");
  });

  it("Should reject AI Agent if destination not whitelisted", async function () {
    const dest = otherAccount.address;
    const value = 0;
    const data = "0x";

    await expect(auraAccount.connect(aiAgent).executeByAgent(dest, value, data))
      .to.be.revertedWithCustomError(auraAccount, "GuardrailRejected");
  });

  it("Should reject AI Agent if value exceeds limit", async function () {
    const dest = mockDapp.target;
    const value = ethers.parseEther("2"); // Limit is 1 ether by default
    const data = "0x";

    await guardrailManager.toggleDestination(dest, true);

    await expect(auraAccount.connect(aiAgent).executeByAgent(dest, value, data))
      .to.be.revertedWithCustomError(auraAccount, "GuardrailRejected");
  });

  it("Should only allow AI Agent to call executeByAgent", async function () {
    const dest = mockDapp.target;
    await expect(auraAccount.connect(otherAccount).executeByAgent(dest, 0, "0x"))
      .to.be.revertedWithCustomError(auraAccount, "NotAuthorized");
  });
});
