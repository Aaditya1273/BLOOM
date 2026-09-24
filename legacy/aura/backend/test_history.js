const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgres://postgres:AuraProtocol2026@34.163.254.250:5432/postgres', ssl: { rejectUnauthorized: false } });
const address = '0xb4DD0565207Ca66432C0BaD06b69Bb97514E033d';
const days = 30;

(async () => {
    const dailyPnl = {};
    const historyQuery = await pool.query(`
        SELECT DATE(to_timestamp(block_timestamp)) as date,
               SUM(pnl * CASE WHEN is_profit THEN 1 ELSE -1 END) as daily_pnl,
               SUM(CASE WHEN is_profit THEN 1 ELSE 0 END) as wins,
               COUNT(*) as trades
        FROM positions_closed
        WHERE LOWER(owner) = $1
        AND to_timestamp(block_timestamp) >= NOW() - INTERVAL '${days} days'
        GROUP BY DATE(to_timestamp(block_timestamp))
    `, [address.toLowerCase()]);

    for (const row of historyQuery.rows) {
        try {
            const dateObj = new Date(row.date);
            if (isNaN(dateObj.getTime())) continue;
            const dateStr = dateObj.toISOString().slice(0, 10);
            
            if (!dailyPnl[dateStr]) {
                dailyPnl[dateStr] = { pnl: 0, trades: 0, wins: 0 };
            }
            
            dailyPnl[dateStr].pnl += (parseFloat(row.daily_pnl || 0) / 1e18);
            dailyPnl[dateStr].trades += parseInt(row.trades || 0, 10);
            dailyPnl[dateStr].wins += parseInt(row.wins || 0, 10);
        } catch(err) {
            console.error(err);
        }
    }

    const sortedDates = Object.keys(dailyPnl).sort();
    let cumulativePnl = 0;
    const history = sortedDates.map(date => {
        const day = dailyPnl[date];
        cumulativePnl += day.pnl;
        return {
            date,
            dailyPnl: parseFloat(day.pnl.toFixed(2)),
            cumulativePnl: parseFloat(cumulativePnl.toFixed(2)),
            trades: day.trades,
            wins: day.wins,
        };
    });

    console.log("HISTORY:", history);
    process.exit(0);
})();
