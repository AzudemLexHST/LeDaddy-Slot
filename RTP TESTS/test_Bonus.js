const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");
const os = require("os");

// ============================================================================
// LE DADDY - FINAL BONUS BUY RTP MULTI-THREAD SIMULATION
// Simuliert 4-, 5- und 6-Scatter Bonus Buy getrennt.
// Passend zum finalen Browser-Math:
// - 4 Scatter Buy: 90x / 8 FS
// - 5 Scatter Buy: 110x / 10 FS
// - 6 Scatter Buy: 135x / 12 FS
// - Bought Bonus nutzt BOUGHT_BONUS_MULTIPLIER_POOL
// - Retrigger in FS ab 3 Scatter => +5 FS
// - Max Win Cap 10.000x
// ============================================================================
//
// Start:
// node test_Bonus.js 100000000
//
// Bedeutet: 100.000.000 gekaufte Boni JE Bonus-Typ.
// ============================================================================

const cCount = 6;
const rCount = 5;
const bet = 1.00;

const MAX_WIN_MULT = 10000;
const maxWinAmount = bet * MAX_WIN_MULT;

const FREE_SPIN_MULTIPLIER_CHANCE = 0.16;
const BOUGHT_BONUS_MULTIPLIER_POOL = [2, 5, 5, 10, 25, 50, 100];

const symbols = [
    { name: "Uhr",          char: "Uhr.png",          type: "highpay", weight: 6,  val: 54.28 },
    { name: "Kette",        char: "Kette.png",        type: "highpay", weight: 8,  val: 31.66 },
    { name: "Sonnenbrille", char: "Sonnenbrille.png", type: "highpay", weight: 10, val: 13.57 },
    { name: "Zigarre",      char: "Zigarre.png",      type: "highpay", weight: 10, val: 18.08 },
    { name: "Ass",          char: "A.png",            type: "leather", weight: 20, val: 3.61 },
    { name: "König",        char: "K.png",            type: "leather", weight: 20, val: 3.17 },
    { name: "Bube",         char: "J.png",            type: "leather", weight: 20, val: 2.72 },
    { name: "Zehn",         char: "10.png",           type: "leather", weight: 20, val: 2.25 }
];

const scatterSymbol = {
    name: "Scatter",
    char: "Scatter.png",
    type: "scatter",
    weight: 2.10,
    val: 0
};

const BONUS_BUY_CONFIG = {
    4: { costMult: 195,  spins: 8  },
    5: { costMult: 240, spins: 10 },
    6: { costMult: 290, spins: 12 }
};

// ============================================================================
// Schneller Seed-RNG für reproduzierbare Simulationen.
// ============================================================================

function createRng(seed) {
    let t = seed >>> 0;

    return function rng() {
        t += 0x6D2B79F5;
        let x = t;
        x = Math.imul(x ^ (x >>> 15), x | 1);
        x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
}

function getRandomSym(rng, allowScatter = true) {
    let totalWeight = 0;

    for (const s of symbols) totalWeight += s.weight;
    if (allowScatter) totalWeight += scatterSymbol.weight;

    let r = rng() * totalWeight;

    for (const s of symbols) {
        if (r < s.weight) return s;
        r -= s.weight;
    }

    if (allowScatter) return scatterSymbol;
    return symbols[0];
}

function runBoughtFreeSpin(rng) {
    const matrix1D = [];
    const mult1D = [];
    const finalMatrix = [];

    let scatterCount = 0;

    for (let c = 0; c < cCount; c++) {
        const colSymbols = [];
        const colMultipliers = [];

        for (let r = 0; r < rCount; r++) {
            const sym = getRandomSym(rng, true);
            colSymbols.push(sym);

            if (sym.char === "Scatter.png") scatterCount++;

            let mult = 1;

            if (sym.type !== "scatter" && rng() < FREE_SPIN_MULTIPLIER_CHANCE) {
                mult = BOUGHT_BONUS_MULTIPLIER_POOL[
                    Math.floor(rng() * BOUGHT_BONUS_MULTIPLIER_POOL.length)
                ];
            }

            colMultipliers.push(mult);
        }

        finalMatrix.push({
            symbols: colSymbols,
            multipliers: colMultipliers
        });
    }

    for (let r = 0; r < rCount; r++) {
        for (let c = 0; c < cCount; c++) {
            matrix1D.push(finalMatrix[c].symbols[r].char);
            mult1D.push(finalMatrix[c].multipliers[r]);
        }
    }

    const checked = Array(rCount * cCount).fill(false);
    let winTotal = 0;

    for (let i = 0; i < rCount * cCount; i++) {
        if (!checked[i] && matrix1D[i] !== "Scatter.png") {
            const matchSym = matrix1D[i];
            const cluster = [];
            const queue = [i];

            checked[i] = true;

            while (queue.length > 0) {
                const curr = queue.shift();
                cluster.push(curr);

                const row = Math.floor(curr / cCount);
                const col = curr % cCount;

                const targets = [];

                if (row > 0) targets.push((row - 1) * cCount + col);
                if (row < rCount - 1) targets.push((row + 1) * cCount + col);
                if (col > 0) targets.push(row * cCount + (col - 1));
                if (col < cCount - 1) targets.push(row * cCount + (col + 1));

                for (const t of targets) {
                    if (!checked[t] && matrix1D[t] === matchSym) {
                        checked[t] = true;
                        queue.push(t);
                    }
                }
            }

            if (cluster.length >= 5) {
                const data = symbols.find(s => s.char === matchSym);
                const clusterMultiplier = 1 + (cluster.length - 5) * 0.45;
                const baseClusterWin = data.val * bet * clusterMultiplier;

                let appliedProduct = 1;

                for (const idx of cluster) {
                    if (mult1D[idx] > 1) {
                        appliedProduct += mult1D[idx] - 1;
                    }
                }

                winTotal += baseClusterWin * appliedProduct;
            }
        }
    }

    return {
        win: winTotal,
        scatters: scatterCount
    };
}

function runBoughtBonus(rng, bonusType) {
    const cfg = BONUS_BUY_CONFIG[bonusType];

    let fsLeft = cfg.spins;
    let totalWin = 0;
    let totalFsPlayed = 0;
    let retriggers = 0;

    while (fsLeft > 0) {
        fsLeft--;
        totalFsPlayed++;

        const result = runBoughtFreeSpin(rng);
        totalWin += result.win;

        if (result.scatters >= 3) {
            fsLeft += 5;
            retriggers++;
        }

        if (totalWin >= maxWinAmount) {
            totalWin = maxWinAmount;
            break;
        }
    }

    return {
        win: totalWin,
        maxWin: totalWin >= maxWinAmount,
        totalFsPlayed,
        retriggers
    };
}

function runWorker() {
    const { iterations, workerId, seedBase } = workerData;
    const rng = createRng(seedBase + workerId * 1000003);

    const local = {
        4: { totalBet: 0, totalWin: 0, maxWins: 0, totalFsPlayed: 0, retriggers: 0 },
        5: { totalBet: 0, totalWin: 0, maxWins: 0, totalFsPlayed: 0, retriggers: 0 },
        6: { totalBet: 0, totalWin: 0, maxWins: 0, totalFsPlayed: 0, retriggers: 0 }
    };

    const progressEvery = Math.max(10000, Math.floor(iterations / 100));

    for (let i = 0; i < iterations; i++) {
        for (const type of [4, 5, 6]) {
            const cost = BONUS_BUY_CONFIG[type].costMult * bet;
            const result = runBoughtBonus(rng, type);

            local[type].totalBet += cost;
            local[type].totalWin += result.win;
            local[type].totalFsPlayed += result.totalFsPlayed;
            local[type].retriggers += result.retriggers;

            if (result.maxWin) {
                local[type].maxWins++;
            }
        }

        if ((i + 1) % progressEvery === 0) {
            parentPort.postMessage({
                type: "progress",
                workerId,
                done: i + 1,
                iterations
            });
        }
    }

    parentPort.postMessage({
        type: "done",
        workerId,
        iterations,
        results: local
    });
}

function formatMs(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;

    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

if (!isMainThread) {
    runWorker();
} else {
    const REQUESTED_BONUSES_PER_TYPE = Number(process.argv[2] || 100000000);
    const numCores = os.cpus().length;
    const numWorkers = Math.max(1, numCores - 1);

    const baseIterations = Math.floor(REQUESTED_BONUSES_PER_TYPE / numWorkers);
    const remainder = REQUESTED_BONUSES_PER_TYPE % numWorkers;

    const seedBase = Date.now() >>> 0;

    const global = {
        4: { totalBet: 0, totalWin: 0, maxWins: 0, totalFsPlayed: 0, retriggers: 0 },
        5: { totalBet: 0, totalWin: 0, maxWins: 0, totalFsPlayed: 0, retriggers: 0 },
        6: { totalBet: 0, totalWin: 0, maxWins: 0, totalFsPlayed: 0, retriggers: 0 }
    };

    let completedWorkers = 0;
    let progressDone = 0;
    const workerProgress = new Map();
    const startedAt = Date.now();

    console.log("\n🚀 STARTE BONUS BUY RTP SIMULATION 🚀");
    console.log(`Bonuskäufe je Typ:      ${REQUESTED_BONUSES_PER_TYPE.toLocaleString("de-DE")}`);
    console.log(`Gesamt-Bonuskäufe:      ${(REQUESTED_BONUSES_PER_TYPE * 3).toLocaleString("de-DE")}`);
    console.log(`CPU-Threads gefunden:   ${numCores}`);
    console.log(`Aktive Worker-Threads:  ${numWorkers}`);
    console.log(`Seed:                   ${seedBase}`);
    console.log("Math:                   Bought Bonus Pool / Natural Cluster\n");

    console.time("⏱️ Dauer");

    const progressTimer = setInterval(() => {
        const percent = (progressDone / REQUESTED_BONUSES_PER_TYPE) * 100;
        const elapsed = Date.now() - startedAt;
        const eta = progressDone > 0 ? elapsed * (REQUESTED_BONUSES_PER_TYPE / progressDone - 1) : 0;

        process.stdout.write(
            `\r📊 Fortschritt: ${percent.toFixed(2).padStart(6)}% | ` +
            `${progressDone.toLocaleString("de-DE")} / ${REQUESTED_BONUSES_PER_TYPE.toLocaleString("de-DE")} je Typ | ` +
            `ETA: ${formatMs(eta)}       `
        );
    }, 1000);

    for (let i = 0; i < numWorkers; i++) {
        const iterations = baseIterations + (i < remainder ? 1 : 0);
        const workerId = i + 1;

        workerProgress.set(workerId, 0);

        const worker = new Worker(__filename, {
            workerData: {
                iterations,
                workerId,
                seedBase
            }
        });

        worker.on("message", (msg) => {
            if (msg.type === "progress") {
                const oldDone = workerProgress.get(msg.workerId) || 0;
                workerProgress.set(msg.workerId, msg.done);
                progressDone += msg.done - oldDone;
                return;
            }

            if (msg.type === "done") {
                const oldDone = workerProgress.get(msg.workerId) || 0;
                workerProgress.set(msg.workerId, msg.iterations);
                progressDone += msg.iterations - oldDone;

                for (const type of [4, 5, 6]) {
                    global[type].totalBet += msg.results[type].totalBet;
                    global[type].totalWin += msg.results[type].totalWin;
                    global[type].maxWins += msg.results[type].maxWins;
                    global[type].totalFsPlayed += msg.results[type].totalFsPlayed;
                    global[type].retriggers += msg.results[type].retriggers;
                }

                completedWorkers++;
                console.log(`\n✅ [Thread ${String(msg.workerId).padStart(2, "0")}] fertig (${completedWorkers}/${numWorkers})`);

                if (completedWorkers === numWorkers) {
                    clearInterval(progressTimer);

                    console.log("\n======================================");
                    console.timeEnd("⏱️ Dauer");
                    console.log("======================================\n");

                    for (const type of [4, 5, 6]) {
                        const cfg = BONUS_BUY_CONFIG[type];
                        const totalBet = global[type].totalBet;
                        const totalWin = global[type].totalWin;

                        const rtp = (totalWin / totalBet) * 100;
                        const avgWinX = totalWin / REQUESTED_BONUSES_PER_TYPE / bet;
                        const fairCost96 = avgWinX / 0.96;
                        const avgFsPlayed = global[type].totalFsPlayed / REQUESTED_BONUSES_PER_TYPE;
                        const retriggerRate = (global[type].retriggers / REQUESTED_BONUSES_PER_TYPE) * 100;
                        const maxWinRate = (global[type].maxWins / REQUESTED_BONUSES_PER_TYPE) * 100;

                        console.log(`🎁 ${type} SCATTER BONUS BUY`);
                        console.log(`Kosten aktuell:        ${cfg.costMult}x`);
                        console.log(`Start-Freispiele:      ${cfg.spins}`);
                        console.log(`Gesamteinsatz:         €${totalBet.toFixed(2)}`);
                        console.log(`Gesamtgewinn:          €${totalWin.toFixed(2)}`);
                        console.log(`Durchschnittsgewinn:   ${avgWinX.toFixed(4)}x`);
                        console.log(`RTP aktuell:           ${rtp.toFixed(4)}%`);
                        console.log(`Fairer Preis @ 96%:    ${fairCost96.toFixed(2)}x`);
                        console.log(`Ø FS gespielt:         ${avgFsPlayed.toFixed(4)}`);
                        console.log(`Retrigger:             ${global[type].retriggers.toLocaleString("de-DE")}`);
                        console.log(`Retrigger-Rate:        ${retriggerRate.toFixed(6)}%`);
                        console.log(`Max Wins:              ${global[type].maxWins.toLocaleString("de-DE")}`);
                        console.log(`Max-Win-Rate:          ${maxWinRate.toFixed(10)}%`);
                        console.log("--------------------------------------");
                    }

                    console.log("\nErwartung mit aktuellen Preisen:");
                    console.log("4 Scatter 90x, 5 Scatter 110x, 6 Scatter 135x sollten grob um 95–97% liegen.\n");
                }
            }
        });

        worker.on("error", (err) => {
            console.error("\nWorker-Fehler:", err);
        });
    }
}