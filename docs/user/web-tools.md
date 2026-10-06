# Web search and fetch

T3 Code gives every agent two web tools, `web_search` and `web_fetch`, and tells it to use them instead of its own. They behave the same with every provider, so you choose the web service once instead of per CLI.

Choose the service in **Settings → Web**. [Firecrawl](https://docs.firecrawl.dev) is the default, and works without an API key on eligible networks; add a key there to raise its rate limits. Exa and Tavily need their API key. Keys are stored on the machine running T3 Code and never shown again after you save them.

Pick **Built-in** to turn the tools off. Each agent then uses its own web search and fetch, if it has them.
