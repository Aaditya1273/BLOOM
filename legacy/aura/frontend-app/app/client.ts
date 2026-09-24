import { createThirdwebClient } from "thirdweb";

// Replace with your actual client ID from Thirdweb dashboard if needed
export const client = createThirdwebClient({
  clientId: process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID || "aura-hackathon-id", 
});
