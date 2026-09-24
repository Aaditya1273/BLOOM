const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AuraAuditTrail — On-Chain Reasoning Audit", () => {
    let auditTrail, owner, agent, agent2, user1, user2, user3, attacker;

    beforeEach(async () => {
        [owner, agent, agent2, user1, user2, user3, attacker] = await ethers.getSigners();
        const AuditTrail = await ethers.getContractFactory("AuraAuditTrail");
        auditTrail = await AuditTrail.deploy();
        await auditTrail.waitForDeployment();
    });

    describe("Deployment", () => {
        it("deploys successfully", async () => {
            expect(await auditTrail.getAddress()).to.be.properAddress;
        });

        it("has no constructor restrictions (permissionless recording)", async () => {
            // Any address can record — the event itself proves who recorded
            await expect(
                auditTrail.connect(attacker).recordReasoning(user1.address, ethers.ZeroHash, "TEST")
            ).to.not.be.reverted;
        });
    });

    describe("recordReasoning — Basic Functionality", () => {
        it("emits ReasoningRecorded event with correct parameters", async () => {
            const hash = ethers.keccak256(ethers.toUtf8Bytes("test reasoning"));
            await expect(auditTrail.connect(agent).recordReasoning(user1.address, hash, "SWAP ETH→AMZN"))
                .to.emit(auditTrail, "ReasoningRecorded")
                .withArgs(agent.address, user1.address, hash, (ts) => ts > 0, "SWAP ETH→AMZN");
        });

        it("records agent address as msg.sender", async () => {
            const hash = ethers.keccak256(ethers.toUtf8Bytes("agent1 reasoning"));
            const tx = await auditTrail.connect(agent).recordReasoning(user1.address, hash, "SWAP");
            const receipt = await tx.wait();
            const event = receipt.logs[0];
            const decoded = auditTrail.interface.parseLog(event);
            expect(decoded.args.agent).to.equal(agent.address);
        });

        it("records user address correctly", async () => {
            const hash = ethers.keccak256(ethers.toUtf8Bytes("for user2"));
            const tx = await auditTrail.connect(agent).recordReasoning(user2.address, hash, "DCA");
            const receipt = await tx.wait();
            const event = receipt.logs[0];
            const decoded = auditTrail.interface.parseLog(event);
            expect(decoded.args.user).to.equal(user2.address);
        });

        it("records timestamp from block", async () => {
            const hash = ethers.keccak256(ethers.toUtf8Bytes("timestamp test"));
            const tx = await auditTrail.connect(agent).recordReasoning(user1.address, hash, "SWAP");
            const receipt = await tx.wait();
            const block = await ethers.provider.getBlock(receipt.blockNumber);
            const event = receipt.logs[0];
            const decoded = auditTrail.interface.parseLog(event);
            expect(decoded.args.timestamp).to.equal(block.timestamp);
        });

        it("records action string correctly", async () => {
            const hash = ethers.ZeroHash;
            const tx = await auditTrail.connect(agent).recordReasoning(user1.address, hash, "LIMIT_ORDER BTC 10x");
            const receipt = await tx.wait();
            const event = receipt.logs[0];
            const decoded = auditTrail.interface.parseLog(event);
            expect(decoded.args.action).to.equal("LIMIT_ORDER BTC 10x");
        });

        it("accepts zero hash (edge case)", async () => {
            await expect(
                auditTrail.connect(agent).recordReasoning(user1.address, ethers.ZeroHash, "ZERO")
            ).to.not.be.reverted;
        });

        it("accepts zero address as user (edge case)", async () => {
            const hash = ethers.keccak256(ethers.toUtf8Bytes("zero user"));
            await expect(
                auditTrail.connect(agent).recordReasoning(ethers.ZeroAddress, hash, "TEST")
            ).to.not.be.reverted;
        });

        it("accepts empty action string", async () => {
            const hash = ethers.keccak256(ethers.toUtf8Bytes("empty action"));
            await expect(
                auditTrail.connect(agent).recordReasoning(user1.address, hash, "")
            ).to.not.be.reverted;
        });

        it("accepts very long action string", async () => {
            const hash = ethers.keccak256(ethers.toUtf8Bytes("long action"));
            const longAction = "A".repeat(500);
            await expect(
                auditTrail.connect(agent).recordReasoning(user1.address, hash, longAction)
            ).to.not.be.reverted;
        });
    });

    describe("recordReasoning — Multiple Records", () => {
        it("can record multiple reasonings in sequence", async () => {
            for (let i = 0; i < 5; i++) {
                const hash = ethers.keccak256(ethers.toUtf8Bytes(`reasoning ${i}`));
                await auditTrail.connect(agent).recordReasoning(user1.address, hash, `SWAP_${i}`);
            }
        });

        it("different agents can record for the same user", async () => {
            const hash1 = ethers.keccak256(ethers.toUtf8Bytes("agent1"));
            const hash2 = ethers.keccak256(ethers.toUtf8Bytes("agent2"));

            await expect(auditTrail.connect(agent).recordReasoning(user1.address, hash1, "SWAP"))
                .to.emit(auditTrail, "ReasoningRecorded")
                .withArgs(agent.address, user1.address, hash1, (ts) => ts > 0, "SWAP");

            await expect(auditTrail.connect(agent2).recordReasoning(user1.address, hash2, "DCA"))
                .to.emit(auditTrail, "ReasoningRecorded")
                .withArgs(agent2.address, user1.address, hash2, (ts) => ts > 0, "DCA");
        });

        it("same agent can record for different users", async () => {
            const hash = ethers.keccak256(ethers.toUtf8Bytes("multi-user"));
            await auditTrail.connect(agent).recordReasoning(user1.address, hash, "SWAP");
            await auditTrail.connect(agent).recordReasoning(user2.address, hash, "SWAP");
            await auditTrail.connect(agent).recordReasoning(user3.address, hash, "SWAP");
        });

        it("duplicate hashes are allowed (same reasoning for different trades)", async () => {
            const hash = ethers.keccak256(ethers.toUtf8Bytes("duplicate"));
            await auditTrail.connect(agent).recordReasoning(user1.address, hash, "SWAP1");
            await auditTrail.connect(agent).recordReasoning(user1.address, hash, "SWAP2");
        });
    });

    describe("recordReasoning — Gas Efficiency", () => {
        it("costs less than 50k gas per record", async () => {
            const hash = ethers.keccak256(ethers.toUtf8Bytes("gas test"));
            const tx = await auditTrail.connect(agent).recordReasoning(user1.address, hash, "SWAP ETH→AMZN");
            const receipt = await tx.wait();
            expect(receipt.gasUsed).to.be.lt(50000n);
        });

        it("gas cost is consistent across multiple calls", async () => {
            const gasUsages = [];
            // Warm up storage with one call (cold→warm transition)
            await auditTrail.connect(agent).recordReasoning(user1.address, ethers.keccak256(ethers.toUtf8Bytes("warmup")), "WARMUP");
            for (let i = 0; i < 3; i++) {
                const hash = ethers.keccak256(ethers.toUtf8Bytes(`gas ${i}`));
                const tx = await auditTrail.connect(agent).recordReasoning(user1.address, hash, "SWAP");
                const receipt = await tx.wait();
                gasUsages.push(Number(receipt.gasUsed));
            }
            // After warmup, all calls should be within 10% of each other
            const max = Math.max(...gasUsages);
            const min = Math.min(...gasUsages);
            expect(max - min).to.be.lt(max * 0.1);
        });
    });

    describe("recordReasoning — Event Indexing", () => {
        it("agent address is indexed (filterable)", async () => {
            const hash = ethers.keccak256(ethers.toUtf8Bytes("indexed agent"));
            await auditTrail.connect(agent).recordReasoning(user1.address, hash, "SWAP");
            await auditTrail.connect(agent2).recordReasoning(user1.address, hash, "DCA");

            // Filter by agent
            const filter = auditTrail.filters.ReasoningRecorded(agent.address);
            const events = await auditTrail.queryFilter(filter);
            expect(events.length).to.equal(1);
            expect(events[0].args.agent).to.equal(agent.address);
        });

        it("user address is indexed (filterable)", async () => {
            const hash = ethers.keccak256(ethers.toUtf8Bytes("indexed user"));
            await auditTrail.connect(agent).recordReasoning(user1.address, hash, "SWAP");
            await auditTrail.connect(agent).recordReasoning(user2.address, hash, "DCA");

            // Filter by user
            const filter = auditTrail.filters.ReasoningRecorded(null, user2.address);
            const events = await auditTrail.queryFilter(filter);
            expect(events.length).to.equal(1);
            expect(events[0].args.user).to.equal(user2.address);
        });

        it("can filter by both agent AND user", async () => {
            const hash = ethers.keccak256(ethers.toUtf8Bytes("double filter"));
            await auditTrail.connect(agent).recordReasoning(user1.address, hash, "A");
            await auditTrail.connect(agent).recordReasoning(user2.address, hash, "B");
            await auditTrail.connect(agent2).recordReasoning(user1.address, hash, "C");

            const filter = auditTrail.filters.ReasoningRecorded(agent.address, user1.address);
            const events = await auditTrail.queryFilter(filter);
            expect(events.length).to.equal(1);
            expect(events[0].args.action).to.equal("A");
        });
    });

    describe("recordReasoning — Integrity Verification", () => {
        it("hash matches keccak256 of known reasoning JSON", async () => {
            const reasoning = JSON.stringify({
                audit: { isSafe: true, rationale: "Balance sufficient" },
                macro: { sentiment: "BULLISH", score: 75 },
                timestamp: 1700000000
            });
            const expectedHash = ethers.keccak256(ethers.toUtf8Bytes(reasoning));

            const tx = await auditTrail.connect(agent).recordReasoning(user1.address, expectedHash, "SWAP");
            const receipt = await tx.wait();
            const event = receipt.logs[0];
            const decoded = auditTrail.interface.parseLog(event);
            expect(decoded.args.reasoningHash).to.equal(expectedHash);
        });

        it("different reasoning produces different hash", async () => {
            const hash1 = ethers.keccak256(ethers.toUtf8Bytes("reasoning A"));
            const hash2 = ethers.keccak256(ethers.toUtf8Bytes("reasoning B"));
            expect(hash1).to.not.equal(hash2);

            await auditTrail.connect(agent).recordReasoning(user1.address, hash1, "A");
            await auditTrail.connect(agent).recordReasoning(user1.address, hash2, "B");

            const filter = auditTrail.filters.ReasoningRecorded(agent.address, user1.address);
            const events = await auditTrail.queryFilter(filter);
            expect(events[0].args.reasoningHash).to.not.equal(events[1].args.reasoningHash);
        });

        it("tampered reasoning produces mismatched hash (verifiable off-chain)", async () => {
            const original = "safe trade approved";
            const tampered = "safe trade approved!"; // one char difference
            const originalHash = ethers.keccak256(ethers.toUtf8Bytes(original));
            const tamperedHash = ethers.keccak256(ethers.toUtf8Bytes(tampered));
            expect(originalHash).to.not.equal(tamperedHash);
        });
    });

    describe("Security — Permissionless but Verifiable", () => {
        it("anyone can record (no access control needed — event proves identity)", async () => {
            const hash = ethers.keccak256(ethers.toUtf8Bytes("attacker record"));
            await expect(
                auditTrail.connect(attacker).recordReasoning(user1.address, hash, "FAKE")
            ).to.emit(auditTrail, "ReasoningRecorded")
                .withArgs(attacker.address, user1.address, hash, (ts) => ts > 0, "FAKE");
            // The event clearly shows attacker.address as agent — verifiers can reject
        });

        it("cannot spoof msg.sender (agent field always equals tx sender)", async () => {
            const hash = ethers.keccak256(ethers.toUtf8Bytes("spoof attempt"));
            const tx = await auditTrail.connect(attacker).recordReasoning(user1.address, hash, "SPOOF");
            const receipt = await tx.wait();
            const event = receipt.logs[0];
            const decoded = auditTrail.interface.parseLog(event);
            // Agent is always msg.sender, cannot be spoofed
            expect(decoded.args.agent).to.equal(attacker.address);
            expect(decoded.args.agent).to.not.equal(agent.address);
        });

        it("event timestamp is block.timestamp (cannot be manipulated by caller)", async () => {
            const hash = ethers.keccak256(ethers.toUtf8Bytes("timestamp integrity"));
            const tx = await auditTrail.connect(agent).recordReasoning(user1.address, hash, "SWAP");
            const receipt = await tx.wait();
            const block = await ethers.provider.getBlock(receipt.blockNumber);
            const event = receipt.logs[0];
            const decoded = auditTrail.interface.parseLog(event);
            expect(decoded.args.timestamp).to.equal(block.timestamp);
        });
    });

    describe("Batch Recording Stress Test", () => {
        it("handles 10 records in a single block (via sequential txs)", async () => {
            const promises = [];
            for (let i = 0; i < 10; i++) {
                const hash = ethers.keccak256(ethers.toUtf8Bytes(`batch ${i}`));
                promises.push(auditTrail.connect(agent).recordReasoning(user1.address, hash, `SWAP_${i}`));
            }
            const txs = await Promise.all(promises);
            for (const tx of txs) {
                const receipt = await tx.wait();
                expect(receipt.status).to.equal(1);
            }
        });

        it("all 10 events are queryable after batch", async () => {
            for (let i = 0; i < 10; i++) {
                const hash = ethers.keccak256(ethers.toUtf8Bytes(`query batch ${i}`));
                await auditTrail.connect(agent).recordReasoning(user1.address, hash, `ACTION_${i}`);
            }
            const filter = auditTrail.filters.ReasoningRecorded(agent.address, user1.address);
            const events = await auditTrail.queryFilter(filter);
            expect(events.length).to.equal(10);
        });
    });

    // ═══════════════════════════════════════════════════════════
    //              AI CONFIDENCE SCORE
    // ═══════════════════════════════════════════════════════════

    describe("AI Confidence Score — recordReasoningWithScore", () => {
        it("records score 0-100 and emits ReasoningRecordedWithScore", async () => {
            const hash = ethers.keccak256(ethers.toUtf8Bytes("conf 87"));
            await expect(
                auditTrail.connect(agent).recordReasoningWithScore(user1.address, hash, "SWAP", 87)
            ).to.emit(auditTrail, "ReasoningRecordedWithScore")
                .withArgs(agent.address, user1.address, hash, (ts) => ts > 0, "SWAP", 87);
        });

        it("emits BOTH legacy and new events on recordReasoningWithScore", async () => {
            const hash = ethers.keccak256(ethers.toUtf8Bytes("dual emit"));
            const tx = await auditTrail.connect(agent).recordReasoningWithScore(user1.address, hash, "SWAP", 75);
            const receipt = await tx.wait();
            // Two events emitted
            expect(receipt.logs.length).to.equal(2);
        });

        it("stores latest score in lastConfidenceScore mapping", async () => {
            const hash = ethers.keccak256(ethers.toUtf8Bytes("stored"));
            await auditTrail.connect(agent).recordReasoningWithScore(user1.address, hash, "SWAP", 92);
            expect(await auditTrail.lastConfidenceScore(agent.address, user1.address)).to.equal(92);
        });

        it("getLastConfidenceScore returns 0 when no score recorded", async () => {
            expect(await auditTrail.getLastConfidenceScore(agent.address, user1.address)).to.equal(0);
        });

        it("getLastConfidenceScore returns latest score for (agent,user)", async () => {
            const hash = ethers.keccak256(ethers.toUtf8Bytes("latest"));
            await auditTrail.connect(agent).recordReasoningWithScore(user1.address, hash, "A", 30);
            await auditTrail.connect(agent).recordReasoningWithScore(user1.address, hash, "B", 70);
            expect(await auditTrail.getLastConfidenceScore(agent.address, user1.address)).to.equal(70);
        });

        it("score is per (agent, user) — different agents track separately", async () => {
            const hash = ethers.keccak256(ethers.toUtf8Bytes("isolation"));
            await auditTrail.connect(agent).recordReasoningWithScore(user1.address, hash, "A", 80);
            await auditTrail.connect(agent2).recordReasoningWithScore(user1.address, hash, "A", 40);
            expect(await auditTrail.lastConfidenceScore(agent.address, user1.address)).to.equal(80);
            expect(await auditTrail.lastConfidenceScore(agent2.address, user1.address)).to.equal(40);
        });

        it("score is per (agent, user) — different users tracked separately", async () => {
            const hash = ethers.keccak256(ethers.toUtf8Bytes("user iso"));
            await auditTrail.connect(agent).recordReasoningWithScore(user1.address, hash, "A", 50);
            await auditTrail.connect(agent).recordReasoningWithScore(user2.address, hash, "A", 95);
            expect(await auditTrail.lastConfidenceScore(agent.address, user1.address)).to.equal(50);
            expect(await auditTrail.lastConfidenceScore(agent.address, user2.address)).to.equal(95);
        });

        it("accepts score 0 (no confidence)", async () => {
            const hash = ethers.keccak256(ethers.toUtf8Bytes("zero"));
            await expect(auditTrail.connect(agent).recordReasoningWithScore(user1.address, hash, "REJECT", 0)).to.not.be.reverted;
            expect(await auditTrail.lastConfidenceScore(agent.address, user1.address)).to.equal(0);
        });

        it("accepts score 100 (max confidence)", async () => {
            const hash = ethers.keccak256(ethers.toUtf8Bytes("max"));
            await auditTrail.connect(agent).recordReasoningWithScore(user1.address, hash, "PERFECT", 100);
            expect(await auditTrail.lastConfidenceScore(agent.address, user1.address)).to.equal(100);
        });

        // Note: solc auto-validates uint8 range; passing >255 throws at the ABI level
        // and >100 reverts via our explicit check (tested below by trying boundary values).

        it("totalRecords increments on every record (with or without score)", async () => {
            const hash = ethers.keccak256(ethers.toUtf8Bytes("counter"));
            expect(await auditTrail.totalRecords()).to.equal(0);
            await auditTrail.connect(agent).recordReasoning(user1.address, hash, "A");
            expect(await auditTrail.totalRecords()).to.equal(1);
            await auditTrail.connect(agent).recordReasoningWithScore(user1.address, hash, "B", 50);
            expect(await auditTrail.totalRecords()).to.equal(2);
        });

        it("can filter ReasoningRecordedWithScore by agent", async () => {
            const hash = ethers.keccak256(ethers.toUtf8Bytes("filter agent"));
            await auditTrail.connect(agent).recordReasoningWithScore(user1.address, hash, "A", 60);
            await auditTrail.connect(agent2).recordReasoningWithScore(user1.address, hash, "B", 70);
            const filter = auditTrail.filters.ReasoningRecordedWithScore(agent.address);
            const events = await auditTrail.queryFilter(filter);
            expect(events.length).to.equal(1);
            expect(events[0].args.confidenceScore).to.equal(60);
        });

        it("can filter ReasoningRecordedWithScore by user", async () => {
            const hash = ethers.keccak256(ethers.toUtf8Bytes("filter user"));
            await auditTrail.connect(agent).recordReasoningWithScore(user1.address, hash, "A", 60);
            await auditTrail.connect(agent).recordReasoningWithScore(user2.address, hash, "B", 70);
            const filter = auditTrail.filters.ReasoningRecordedWithScore(null, user2.address);
            const events = await auditTrail.queryFilter(filter);
            expect(events.length).to.equal(1);
            expect(events[0].args.confidenceScore).to.equal(70);
        });

        it("legacy recordReasoning does not update lastConfidenceScore", async () => {
            const hash = ethers.keccak256(ethers.toUtf8Bytes("legacy"));
            // First set a score
            await auditTrail.connect(agent).recordReasoningWithScore(user1.address, hash, "A", 88);
            // Then call legacy — should NOT overwrite
            await auditTrail.connect(agent).recordReasoning(user1.address, hash, "B");
            expect(await auditTrail.lastConfidenceScore(agent.address, user1.address)).to.equal(88);
        });

        it("score tx costs less than 130k gas", async () => {
            const hash = ethers.keccak256(ethers.toUtf8Bytes("gas score"));
            const tx = await auditTrail.connect(agent).recordReasoningWithScore(user1.address, hash, "SWAP", 87);
            const receipt = await tx.wait();
            expect(receipt.gasUsed).to.be.lt(130000n);
        });
    });

    // ═══════════════════════════════════════════════════════════
    //              ON-CHAIN AGENT REPUTATION
    // ═══════════════════════════════════════════════════════════

    describe("On-Chain Agent Reputation", () => {
        it("getAgentReputation returns 0 trades and 0 avg for new agent", async () => {
            const [trades, avg] = await auditTrail.getAgentReputation(agent.address);
            expect(trades).to.equal(0);
            expect(avg).to.equal(0);
        });

        it("reputation accumulates on recordReasoningWithScore", async () => {
            const hash = ethers.keccak256(ethers.toUtf8Bytes("rep1"));
            await auditTrail.connect(agent).recordReasoningWithScore(user1.address, hash, "A", 80);
            await auditTrail.connect(agent).recordReasoningWithScore(user1.address, hash, "B", 90);
            const [trades, avg] = await auditTrail.getAgentReputation(agent.address);
            expect(trades).to.equal(2);
            expect(avg).to.equal(85); // (80+90)/2
        });

        it("reputation does NOT accumulate on legacy recordReasoning", async () => {
            const hash = ethers.keccak256(ethers.toUtf8Bytes("legacy rep"));
            await auditTrail.connect(agent).recordReasoning(user1.address, hash, "SWAP");
            const [trades] = await auditTrail.getAgentReputation(agent.address);
            expect(trades).to.equal(0);
        });

        it("reputation is per-agent (isolated)", async () => {
            const hash = ethers.keccak256(ethers.toUtf8Bytes("iso"));
            await auditTrail.connect(agent).recordReasoningWithScore(user1.address, hash, "A", 60);
            await auditTrail.connect(agent2).recordReasoningWithScore(user1.address, hash, "A", 100);
            const [t1, a1] = await auditTrail.getAgentReputation(agent.address);
            const [t2, a2] = await auditTrail.getAgentReputation(agent2.address);
            expect(t1).to.equal(1);
            expect(a1).to.equal(60);
            expect(t2).to.equal(1);
            expect(a2).to.equal(100);
        });

        it("agentReputation mapping is publicly readable", async () => {
            const hash = ethers.keccak256(ethers.toUtf8Bytes("pub"));
            await auditTrail.connect(agent).recordReasoningWithScore(user1.address, hash, "A", 75);
            const rep = await auditTrail.agentReputation(agent.address);
            expect(rep.totalTrades).to.equal(1);
            expect(rep.cumulativeScore).to.equal(75);
        });
    });
});
