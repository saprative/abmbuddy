import { loadConfig } from "./src/config/index.js";
import { getAccessToken } from "./src/crm/hubspot-auth.js";
import { Client } from "@hubspot/api-client";

async function main() {
  const config = await loadConfig();
  const token = await getAccessToken(config);
  const client = new Client({ accessToken: token });

  try {
    const res = await client.crm.companies.searchApi.doSearch({
      query: "HubSpot",
      limit: 10,
    });
    console.log("Success:", res.results.length);
  } catch (e: any) {
    console.error("Error:", e.message);
    if (e.body) console.error(JSON.stringify(e.body, null, 2));
  }
}
main();
