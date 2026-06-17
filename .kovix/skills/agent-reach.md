# Agent Reach — Internet Research Toolkit

## Overview

Agent Reach gives you access to the entire internet. You can search websites, YouTube, GitHub, Twitter/X, Reddit, Bilibili, Xiaohongshu, and more — all without API keys.

## When to Use Each Tool

### Web & Content

- **agent_reach__read_webpage** — Use when the user asks about a specific URL, documentation page, article, or website. Returns clean text, not HTML.
- **agent_reach__read_rss** — Use when the user asks about news, blog updates, or mentions a feed URL. Returns recent articles with titles and links.

### Video Platforms

- **agent_reach__search_youtube** — Use when the user asks for video tutorials, video content, or mentions "YouTube".
- **agent_reach__get_youtube_transcript** — Use when the user wants to summarize a video, find specific info in a video, or mentions "transcript".

### Code & Developer Platforms

- **agent_reach__search_github** — Use when the user asks for libraries, code examples, repos, or mentions "GitHub".

### Social Media & Forums

- **agent_reach__search_twitter** — Use for trending topics, recent tweets, or when the user mentions "Twitter" or "X". ⚠️ Requires cookie setup.
- **agent_reach__search_reddit** — Use for community discussions, opinions, troubleshooting. ⚠️ May require login for some subreddits.
- **agent_reach__search_bilibili** — Use for Chinese-language tutorials, anime, tech content. Works without login.
- **agent_reach__search_xiaohongshu** — Use for product reviews, travel guides, lifestyle Chinese content. ⚠️ Requires login.

### AI Search

- **agent_reach__search_exa** — Use for broad research questions where semantic understanding matters. This is an AI-powered search that finds content by meaning, not just keywords.

### Diagnostics

- **agent_reach__doctor** — Use when another Agent Reach tool fails. This diagnoses which channels are working and which need setup.

## Authentication Requirements

| Platform | Requires Auth | How to Configure |
|----------|---------------|------------------|
| YouTube | No | Works out of the box |
| GitHub | No (public repos) | Optional: `gh auth login` for private repos |
| Bilibili | No | Works out of the box |
| RSS | No | Works out of the box |
| Exa Search | No | Works out of the box |
| Twitter/X | Yes (cookies) | Run `agent-reach configure twitter-cookies "..."` |
| Reddit | Sometimes | Run `agent-reach configure reddit-cookies "..."` |
| Xiaohongshu | Yes (cookies) | Run `agent-reach configure xiaohongshu-cookies "..."` |

## Error Handling Guide

When a tool returns an error:

1. Check if it's an authentication error → Explain to user that setup is needed
2. Check if it's a timeout → The site may be slow; suggest trying again
3. Check if it's a "not found" → The content may not exist
4. For any persistent failure → Run `agent_reach__doctor` to diagnose

## Example Prompts

**User:** "Find the latest React tutorials on YouTube"
→ Call: `agent_reach__search_youtube({"query": "React tutorials 2025", "max_results": 5})`

**User:** "Read the Next.js documentation about routing"
→ Call: `agent_reach__read_webpage({"url": "https://nextjs.org/docs/app/building-your-application/routing"})`

**User:** "What are people saying about the new iPhone on Reddit?"
→ Call: `agent_reach__search_reddit({"query": "new iPhone", "subreddit": "apple", "max_results": 10})`

**User:** "Search for AI agent frameworks on GitHub"
→ Call: `agent_reach__search_github({"query": "AI agent framework", "type": "repositories", "max_results": 10})`
