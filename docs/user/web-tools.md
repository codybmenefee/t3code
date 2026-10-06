# Web search and fetch

T3 Code gives every agent two web tools, `web_search` and `web_fetch`. They behave the same with every provider, so you choose the web service once instead of per CLI.

Choose the service in **Settings → Web**, on web, desktop, or mobile. [Firecrawl](https://docs.firecrawl.dev) is the default, and works without an API key on eligible networks; add a key there to raise its rate limits. Exa and Tavily need their API key. Keys are stored on the machine running T3 Code and never shown again after you save them.

While a service is selected, Claude, Codex, Cursor, and OpenCode lose their own web search and fetch, so every search goes through it. Other agents keep their own web tools and are asked to prefer T3 Code's. The change applies to sessions started after it.

Pick **Built-in** to turn T3 Code's tools off. Every agent then uses its own web search and fetch, if it has them.
