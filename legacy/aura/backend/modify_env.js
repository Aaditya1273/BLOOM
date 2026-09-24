const fs = require('fs');
const envPath = 'C:\\Users\\maxen\\Documents\\arbitrum_hackathon\\backend\\.env';
let envContent = fs.readFileSync(envPath, 'utf8');
// We will replace this later once we deploy the Escrow.
