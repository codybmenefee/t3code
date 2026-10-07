# Tools

**Settings → Tools** adds vendors' own MCP servers to the agent sessions T3 Code starts, the same way T3 Code adds its own tools. T3 Code holds the credential and the connection; your agents call the vendor's tools directly. Nothing is written to your agents' own configuration, so agents you run outside T3 Code are unchanged.

Tools are set per machine, like providers. Pick the machine at the top of the page. Claude Code, Codex, and Cursor sessions get the tools you add; sessions that are already open get them when they restart.

## Web

The **Web** list holds the web tools you have added and **Built-in**, the agents' own web search and fetch.

- **Set as default** tells sessions to use that tool first for web search and page reading. Built-in stays on as the fallback, so agents still search when the default tool is unavailable or fails. Make Built-in the default to go back to the agents' own tools.
- **Tools** on a tool's page turns its tool categories on or off. Cursor sessions get every tool, because Cursor cannot turn off single MCP tools.

### Firecrawl

[Firecrawl's MCP server](https://docs.firecrawl.dev/mcp-server) is built in and always listed. Select **+** next to it to add it; removing it turns it off and keeps its credential.

How sessions connect, in order of precedence:

- **Sign in with Firecrawl** opens your browser to sign in to your Firecrawl account. Sessions then use your account's tools and limits.
- **API key** sends the key you save to Firecrawl's server.
- **Keyless**, with neither, connects without a credential. Keyless sessions get search, scrape, and parse within Firecrawl's daily limits, on networks Firecrawl allows.

### Exa and Tavily

Select **+** at the top of the list to add [Exa](https://docs.exa.ai/reference/exa-mcp) or [Tavily](https://docs.tavily.com/documentation/mcp). Sessions get them once they have a credential: an API key for either, or a browser sign-in for Exa. Removing one takes it off the list and deletes its stored credential.

Credentials are kept in T3 Code's secret store on that machine. If a tool's server stops connecting, for example because a sign-in expires, a notification points you to **Settings → Tools**.
