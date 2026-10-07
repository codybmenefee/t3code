# Web search and fetch

T3 Code can give every agent two web tools, `web_search` and `web_fetch`, backed by one web service you choose instead of each CLI's own. They behave the same with every provider.

By default, Settings → Web is set to **Built-in**: each agent uses its own web search and fetch, as before. Pick a service in **Settings → Web**, on web, desktop, or mobile, to turn T3 Code's tools on. [Firecrawl](https://docs.firecrawl.dev) works without an API key on eligible networks; add a key there to raise its rate limits. Exa and Tavily need their API key. Keys are stored on the machine running T3 Code and never shown again after you save them.

While a service is selected, Claude, Codex, Cursor, and OpenCode lose their own web search and fetch, so every search goes through it. Other agents keep their own web tools and are asked to prefer T3 Code's. The change applies to sessions started after it.
