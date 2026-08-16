import { Client } from "@hubspot/api-client";
const client = new Client();
client.crm.companies.searchApi.doSearch({
    query: "test",
});
