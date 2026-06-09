const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");
const os = require("os");

// ============================================================================
// LE DADDY - BONUS HUNT RTP MULTI-THREAD SIMULATION
// Simuliert Bonus Hunt RTP
// - Start per Argument: node test_Hunt.js 1000000000
// - Ohne Argument läuft automatisch 1.000.000.000 Spins
// - Worker-Threads automatisch: CPU-Kerne - 1
//
// Bonus Hunt Logik:
// - Einsatz pro Spin = bet * BONUS_HUNT_COST_MULT
// - Basegame-Scattergewicht = scatterSymbol.weight * BONUS_HUNT_SCATTER_MULT
// - Freispiele verwenden normales Scattergewicht
// - 4/5/6 Scatter => 8/10/12 FS
// - Retrigger in FS ab 3 Scatter => +5 FS
// - normale FS-Multiplier-Pool, nicht Bonus-Buy-Pool
// - Max Win Cap 10.000x
// ============================================================================

const cCount = 6;
const rCount = 5;
const bet = 1.00;

const TARGET_RTP = 96;
const MAX_WIN_MULT = 10000;
const maxWinAmount = bet * MAX_WIN_MULT;

// Im Browser-Code danach nur diesen Wert anpassen, wenn das Script einen fairen Preis ausgibt.
const BONUS_HUNT_COST_MULT = 9.9577;
const BONUS_HUNT_SCATTER_MULT = 3.5;

const FREE_SPIN_MULTIPLIER_CHANCE = 0.16;
const FREE_SPIN_MULTIPLIER_POOL = [2, 2, 2, 3, 5, 5, 10, 25, 50];

const symbols = [
    { name: "Uhr",          char: "Uhr.png",          type: "highpay", weight: 6,  val: 54.28 },
    { name: "Kette",        char: "Kette.png",        type: "highpay", weight: 8,  val: 31.66 },
    { name: "Sonnenbrille", char: "Sonnenbrille.png", type: "highpay", weight: 10, val: 13.57 },
    { name: "Zigarre",      char: "Zigarre.png",      type: "highpay", weight: 10, val: 18.08 },
    { name: "Ass",          char: "A.png",            type: "leather", weight: 20, val: 3.61 },
    { name: "König",        char: "K.png",            type: "leather", weight: 20, val: 3.17 },
    { name: "Bube",         char: "J.png",           type: "leather", weight: 20, val: 2.72 },
    { name: "Zehn",         char: "10.png",            type: "leather", weight: 20, val: 2.25 }
];

const scatterSymbol = {
    name: "Scatter",
    char: "Scatter.png",
    type: "scatter",
    weight: 2.10,
    val: 0
};

const normalScatterWeight = scatterSymbol.weight;
const bonusHuntScatterWeight = scatterSymbol.weight * BONUS_HUNT_SCATTER_MULT;

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

function getRandomSym(rng, scatterWeight) {
    let totalWeight = scatterWeight;
    for (const s of symbols) totalWeight += s.weight;

    let r = rng() * totalWeight;

    for (const s of symbols) {
        if (r < s.weight) return s;
        r -= s.weight;
    }

    return scatterSymbol;
}

function runSpin(rng, isFs, scatterWeight) {
    const matrix1D = [];
    const mult1D = [];

    let scatterCount = 0;

    const finalMatrix = [];

    for (let c = 0; c < cCount; c++) {
        const colSymbols = [];
        const colMultipliers = [];

        for (let r = 0; r < rCount; r++) {
            const sym = getRandomSym(rng, scatterWeight);
            colSymbols.push(sym);

            if (sym.char === "Scatter.png") scatterCount++;

            let mult = 1;
            if (isFs && sym.type !== "scatter" && rng() < FREE_SPIN_MULTIPLIER_CHANCE) {
                mult = FREE_SPIN_MULTIPLIER_POOL[
                    Math.floor(rng() * FREE_SPIN_MULTIPLIER_POOL.length)
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

function runBonusHuntSpin(rng) {
    let currentWin = 0;
    let baseWin = 0;
    let fsWin = 0;
    let maxWin = false;
    let triggeredBonus = false;
    let startFs = 0;
    let totalFsPlayed = 0;
    let retriggers = 0;
    let baseScatterCount = 0;

    const baseResult = runSpin(rng, false, bonusHuntScatterWeight);
    baseWin += baseResult.win;
    currentWin += baseResult.win;
    baseScatterCount = baseResult.scatters;

    if (currentWin >= maxWinAmount) {
        return {
            win: maxWinAmount,
            baseWin: maxWinAmount,
            fsWin: 0,
            maxWin: true,
            triggeredBonus: false,
            startFs: 0,
            totalFsPlayed: 0,
            retriggers: 0,
            baseScatterCount
        };
    }

    if (baseResult.scatters >= 4) {
        triggeredBonus = true;

        if (baseResult.scatters === 4) startFs = 8;
        else if (baseResult.scatters === 5) startFs = 10;
        else startFs = 12;

        let fsLeft = startFs;

        while (fsLeft > 0) {
            fsLeft--;
            totalFsPlayed++;

            // Wichtig: Freispiele verwenden normales Scattergewicht, NICHT Bonus-Hunt-Boost.
            const fsResult = runSpin(rng, true, normalScatterWeight);
            fsWin += fsResult.win;
            currentWin += fsResult.win;

            if (fsResult.scatters >= 3) {
                fsLeft += 5;
                retriggers++;
            }

            if (currentWin >= maxWinAmount) {
                currentWin = maxWinAmount;
                maxWin = true;
                break;
            }
        }
    }

    if (maxWin) {
        const cappedFsWin = Math.max(0, maxWinAmount - baseWin);
        return {
            win: maxWinAmount,
            baseWin,
            fsWin: cappedFsWin,
            maxWin,
            triggeredBonus,
            startFs,
            totalFsPlayed,
            retriggers,
            baseScatterCount
        };
    }

    return {
        win: currentWin,
        baseWin,
        fsWin,
        maxWin,
        triggeredBonus,
        startFs,
        totalFsPlayed,
        retriggers,
        baseScatterCount
    };
}

function runWorker() {
    const { spins, workerId, seedBase } = workerData;
    const rng = createRng(seedBase + workerId * 1000003);

    let totalBet = 0;
    let totalWin = 0;
    let totalBaseWin = 0;
    let totalFsWin = 0;
    let maxWins = 0;
    let bonusTriggers = 0;
    let trigger4 = 0;
    let trigger5 = 0;
    let trigger6plus = 0;
    let totalFsPlayed = 0;
    let retriggers = 0;

    const progressEvery = Math.max(100000, Math.floor(spins / 100));

    for (let i = 0; i < spins; i++) {
        totalBet += bet * BONUS_HUNT_COST_MULT;

        const result = runBonusHuntSpin(rng);
        totalWin += result.win;
        totalBaseWin += result.baseWin;
        totalFsWin += result.fsWin;

        if (result.maxWin) maxWins++;

        if (result.triggeredBonus) {
            bonusTriggers++;
            if (result.startFs === 8) trigger4++;
            else if (result.startFs === 10) trigger5++;
            else trigger6plus++;
        }

        totalFsPlayed += result.totalFsPlayed;
        retriggers += result.retriggers;

        if ((i + 1) % progressEvery === 0) {
            parentPort.postMessage({
                type: "progress",
                workerId,
                done: i + 1,
                spins
            });
        }
    }

    parentPort.postMessage({
        type: "done",
        workerId,
        totalBet,
        totalWin,
        totalBaseWin,
        totalFsWin,
        maxWins,
        bonusTriggers,
        trigger4,
        trigger5,
        trigger6plus,
        totalFsPlayed,
        retriggers
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
    const TOTAL_SPINS = Number(process.argv[2] || 1000000000);
    const numCores = os.cpus().length;
    const numWorkers = Math.max(1, numCores - 1);

    const baseSpins = Math.floor(TOTAL_SPINS / numWorkers);
    const remainder = TOTAL_SPINS % numWorkers;

    const seedBase = Date.now() >>> 0;

    let completedWorkers = 0;
    let progressDone = 0;
    const workerProgress = new Map();

    let globalTotalBet = 0;
    let globalTotalWin = 0;
    let globalTotalBaseWin = 0;
    let globalTotalFsWin = 0;
    let globalMaxWins = 0;
    let globalBonusTriggers = 0;
    let globalTrigger4 = 0;
    let globalTrigger5 = 0;
    let globalTrigger6plus = 0;
    let globalTotalFsPlayed = 0;
    let globalRetriggers = 0;

    const startedAt = Date.now();

    console.log("\n🚀 STARTE BONUS HUNT RTP SIMULATION 🚀");
    console.log(`Ziel-Spins:             ${TOTAL_SPINS.toLocaleString("de-DE")}`);
    console.log(`CPU-Threads gefunden:   ${numCores}`);
    console.log(`Aktive Worker-Threads:  ${numWorkers}`);
    console.log(`Seed:                   ${seedBase}`);
    console.log("Math:                   Bonus Hunt / keine künstlichen Cluster");
    console.log(`Bonus Hunt Einsatz:     ${BONUS_HUNT_COST_MULT.toFixed(4)}x`);
    console.log(`Base Scatter Weight:    ${normalScatterWeight}`);
    console.log(`Hunt Scatter Weight:    ${bonusHuntScatterWeight.toFixed(4)} (${BONUS_HUNT_SCATTER_MULT}x)`);
    console.log("Freispiele:             normales Scattergewicht\n");

    console.time("⏱️ Dauer");

    const progressTimer = setInterval(() => {
        const percent = (progressDone / TOTAL_SPINS) * 100;
        const elapsed = Date.now() - startedAt;
        const eta = progressDone > 0 ? elapsed * (TOTAL_SPINS / progressDone - 1) : 0;

        process.stdout.write(
            `\r📊 Fortschritt: ${percent.toFixed(2).padStart(6)}% | ` +
            `${progressDone.toLocaleString("de-DE")} / ${TOTAL_SPINS.toLocaleString("de-DE")} | ` +
            `ETA: ${formatMs(eta)}       `
        );
    }, 1000);

    for (let i = 0; i < numWorkers; i++) {
        const spins = baseSpins + (i < remainder ? 1 : 0);
        const workerId = i + 1;
        workerProgress.set(workerId, 0);

        const worker = new Worker(__filename, {
            workerData: {
                spins,
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
                const finalDone = msg.totalBet / (bet * BONUS_HUNT_COST_MULT);

                workerProgress.set(msg.workerId, finalDone);
                progressDone += finalDone - oldDone;

                globalTotalBet += msg.totalBet;
                globalTotalWin += msg.totalWin;
                globalTotalBaseWin += msg.totalBaseWin;
                globalTotalFsWin += msg.totalFsWin;
                globalMaxWins += msg.maxWins;
                globalBonusTriggers += msg.bonusTriggers;
                globalTrigger4 += msg.trigger4;
                globalTrigger5 += msg.trigger5;
                globalTrigger6plus += msg.trigger6plus;
                globalTotalFsPlayed += msg.totalFsPlayed;
                globalRetriggers += msg.retriggers;

                completedWorkers++;
                console.log(`\n✅ [Thread ${String(msg.workerId).padStart(2, "0")}] fertig (${completedWorkers}/${numWorkers})`);

                if (completedWorkers === numWorkers) {
                    clearInterval(progressTimer);

                    const rtp = (globalTotalWin / globalTotalBet) * 100;
                    const avgWinX = globalTotalWin / TOTAL_SPINS / bet;
                    const avgBaseWinX = globalTotalBaseWin / TOTAL_SPINS / bet;
                    const avgFsWinX = globalTotalFsWin / TOTAL_SPINS / bet;
                    const hitBonusRate = (globalBonusTriggers / TOTAL_SPINS) * 100;
                    const spinsPerBonus = globalBonusTriggers > 0 ? TOTAL_SPINS / globalBonusTriggers : Infinity;
                    const maxWinRate = (globalMaxWins / TOTAL_SPINS) * 100;
                    const avgFsPerHuntSpin = globalTotalFsPlayed / TOTAL_SPINS;
                    const retriggerRatePerHuntSpin = (globalRetriggers / TOTAL_SPINS) * 100;
                    const fairCostMult = avgWinX / (TARGET_RTP / 100);

                    console.log("\n======================================");
                    console.timeEnd("⏱️ Dauer");
                    console.log("======================================");
                    console.log(`💰 Gesamteinsatz:        €${globalTotalBet.toFixed(2)}`);
                    console.log(`🤑 Gesamtgewinn:         €${globalTotalWin.toFixed(2)}`);
                    console.log(`📈 Bonus Hunt RTP:       ${rtp.toFixed(4)}%`);
                    console.log(`Ø Auszahlung pro Spin:   ${avgWinX.toFixed(6)}x`);
                    console.log(`Ø Basegame-Anteil:       ${avgBaseWinX.toFixed(6)}x`);
                    console.log(`Ø Freispiele-Anteil:     ${avgFsWinX.toFixed(6)}x`);
                    console.log(`Fairer Preis @ ${TARGET_RTP}%:     ${fairCostMult.toFixed(4)}x`);
                    console.log("--------------------------------------");
                    console.log(`🎁 Bonus Trigger:        ${globalBonusTriggers.toLocaleString("de-DE")}`);
                    console.log(`🎁 Bonus Trigger Rate:   ${hitBonusRate.toFixed(6)}%`);
                    console.log(`🎁 Ø Spins pro Bonus:    ${Number.isFinite(spinsPerBonus) ? spinsPerBonus.toFixed(2) : "∞"}`);
                    console.log(`4 Scatter Trigger:       ${globalTrigger4.toLocaleString("de-DE")}`);
                    console.log(`5 Scatter Trigger:       ${globalTrigger5.toLocaleString("de-DE")}`);
                    console.log(`6+ Scatter Trigger:      ${globalTrigger6plus.toLocaleString("de-DE")}`);
                    console.log(`Ø FS pro Hunt Spin:      ${avgFsPerHuntSpin.toFixed(6)}`);
                    console.log(`Retrigger:               ${globalRetriggers.toLocaleString("de-DE")}`);
                    console.log(`Retrigger/HuntSpin:      ${retriggerRatePerHuntSpin.toFixed(6)}%`);
                    console.log("--------------------------------------");
                    console.log(`🔥 Max Wins:             ${globalMaxWins.toLocaleString("de-DE")}`);
                    console.log(`🔥 Max-Win-Rate:         ${maxWinRate.toFixed(10)}%`);
                    console.log("--------------------------------------");
                    console.log("Code-Anpassung im Browser:");
                    console.log(`const BONUS_HUNT_COST_MULT = ${fairCostMult.toFixed(4)};`);
                    console.log(`const BONUS_HUNT_SCATTER_MULT = ${BONUS_HUNT_SCATTER_MULT};`);
                    console.log("======================================\n");
                }
            }
        });

        worker.on("error", (err) => {
            console.error("\nWorker-Fehler:", err);
        });
    }
}