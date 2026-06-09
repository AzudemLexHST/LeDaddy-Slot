// ============================================================================
// LE DADDY - BASEGAME RTP MULTI-THREAD SIMULATION
// Simuliert Basegame inkl. natürlich getriggerter Freispiele.
// Passend zum finalen Browser-Math:
// - keine künstlichen Cluster
// - 6x5 Grid
// - Cluster ab 5
// - 4/5/6 Scatter => 8/10/12 FS
// - Retrigger in FS ab 3 Scatter => +5 FS
// - normale FS nutzen FREE_SPIN_MULTIPLIER_POOL
// - Max Win Cap 10.000x
// ============================================================================
//
// Start:
// node test_Basegame.js 1000000000
//
// Ohne Argument läuft automatisch 1.000.000.000 Spins.
// ============================================================================


// ============================================================================
// LE DADDY - BONUS BUY RTP MULTI-THREAD SIMULATION
// Simuliert 4-, 5- und 6-Scatter Bonus Buy getrennt.
// Passend zum finalen Browser-Math:
// - 4 Scatter Buy: 90x / 8 FS
// - 5 Scatter Buy: 110x / 10 FS
// - 6 Scatter Buy: 135x / 12 FS
// - Gekaufter Bonus nutzt BOUGHT_BONUS_MULTIPLIER_POOL
// - Retrigger in FS ab 3 Scatter => +5 FS
// - Max Win Cap 10.000x
// ============================================================================
//
// Start:
// node test_Bonus.js 100000000
//
// Bedeutet: 100.000.000 gekaufte Boni JE Bonus-Typ.
// ============================================================================


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