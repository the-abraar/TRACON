https://mcpmarket.com/tools/skills/visualizing-subagents


Go to ClaudeAI
r/ClaudeAI
•
7mo ago
u/heyImSim

Agent Flow: A beautiful way to visualize what Claude Code does
 

0:14 / 2:38




Claude Code is powerful, but its execution is a black box. You see the final result, not the journey. Agent Flow makes the invisible visible in realtime:

Understand agent behavior: See how Claude breaks down problems, which tools it reaches for, and how subagents coordinate
Debug tool call chains: When something goes wrong, trace the exact sequence of decisions and tool calls that led there
See where time is spent: Identify slow tool calls, unnecessary branching, or redundant work at a glance
Learn by watching: Build intuition for how to write better prompts by observing how Claude interprets and executes them
It's also been really useful when building agents into your own product. Having a visual way to see how an agent actually behaves makes it much easier to iterate on prompts, tool design, and orchestration logic.

It's also been invaluable when building agents into your own product. I've been using it every day to understand how the Anthropic Agent SDK behaves inside CraftMyGame, my video game AI product seeing agent orchestration visually makes it so much easier to iterate on prompts, tool design, and coordination logic

It's also interactive, and shows what's happening as Claude Code works: which agents are active, what tools they're calling, how they coordinate, and where time and tokens are being spent.

You can pan, zoom, click into any agent or tool call to inspect it. It runs as a VS Code extension — opens as a panel right alongside your editor.

What you can see:

Live agent spawning, branching, and completion
Every tool call with timing and token usage
Token consumption per task and per session
Parent-child agent relationships
File attention heatmaps (which files agents are reading/writing most)
Full transcript replay
Multi-session support for concurrent workflows
Currently works with VSCode, but hopefully iterm2 is coming soon.
GitHub: https://github.com/patoles/agent-flow
Demo: https://www.youtube.com/watch?v=Ud6eDrFN-TA
301
·
48
 u/interservermike avatar
interservermike
•
Ad
 
VPS Hosting For Self Hosted AI Tools.
Learn More
interserver.net
 Thumbnail image: VPS Hosting For Self Hosted AI Tools.
Comments Section
u/siganakis avatar
siganakis
•
7mo ago
This looks fantastic. Great work!
19
u/heyImSim avatar
heyImSim
OP
•
7mo ago
thanks!
1
 u/SwiftAndDecisive avatar
SwiftAndDecisive
•
7mo ago
Very good work! Can port this over for Codex as well?
4
u/heyImSim avatar
heyImSim
OP
•
7mo ago
if there is demand yes! feel free to contribute too :)
4
u/SwiftAndDecisive avatar
SwiftAndDecisive
•
7mo ago
Commited and Sent PR over
4

2 more replies
Morgoth92
•
7mo ago
It does not seem to work for me. I installed the extension, opened a new sessione of claude code CLI in VSC and nothing happens. Any suggestions?
3
u/heyImSim avatar
heyImSim
OP
•
7mo ago
can you try to reload VSCode?

or try in the palette: "Developer : Reload Window"
1

2 more replies
 u/Grok-by-SpaceXAI avatar
u/Grok-by-SpaceXAI
•
Ad
 
Grok Bot works on its own computer, not yours. It clicks through apps and websites while you get on with your day.
Sign Up
x.ai
 Thumbnail image: Grok Bot works on its own computer, not yours. It clicks through apps and websites while you get on with your day.
addiktion
•
7mo ago
Wow this is crazy cool. I was doing something similar designing out how they should look to show the communication paths and how to identify them as nodes, but I hadn't gotten around to deciding what tech to use yet.

It looks like you decided on D3 force and Canvas 2D. Any reason to prefer that? I was looking into react flow, three js, svg with offset, and others so was just curious.
4
u/Specialist-Heat-6414 avatar
Specialist-Heat-6414
•
7mo ago
The observability gap in agentic systems is real and undersolved. Most people debug by reading the terminal output backwards after something breaks. Realtime tool call visualization changes the feedback loop completely — you can see the agent going down the wrong path before it finishes.

The next useful layer would be cost attribution per branch. Not just what happened, but what each decision tree cost in tokens and time. That is where you start making principled tradeoffs about agent design.
4
HB_Stratos
•
7mo ago
I just wanted to try this, and it doesn't seem to work? If I tell it to connect to the demo it works, if I check in .claude settings, the hooks are there, but it just does nothing. No matter if I tell it to use the hooks or point it to the session json, nothing ever happens in the window despite it saying live at the top. Any ideas?
2
JimRaid
•
7mo ago
How does it look with agent teams?
2
Teddybear416
•
7mo ago
Cool project
1
QyMbEr
•
7mo ago
Nice work!
1
u/maxfield-app avatar
maxfield-app
•
7mo ago
always a fan of visuals!
1
u/QVAC_Official avatar
u/QVAC_Official
•
Ad
 
Will local AI ever catch up with frontier models?
Read More
reddit.com
 Thumbnail image: Will local AI ever catch up with frontier models?
yourstarownik
•
7mo ago
Cool
1
premiumleo
•
7mo ago
that looks beautiful. need to install now. works with command-line terminal? and here I am writing a basic-a$$ claude usage widget ^_^

https://github.com/premiumlion/windows-claude-code-usage-widget
1
Poisonedhero
•
7mo ago
This looks really awesome, nice work.
1
premiumleo
•
7mo ago
seems there are a couple nuances for it to work. I'm expanding a couple features into it like "dropdown" to select the terminal you want to visualize (this also lets you see if it's been connected properly)
1

1 more reply
ComfortableNice8482
•
7mo ago
honest thing is i've built similar visualizations for automation workflows and the value is huge. when you're running complex tool chains, especially with multiple agents coordinating, you lose hours debugging if you can't see what actually happened. we had a skip tracing workflow that was taking way longer than expected and without proper logging/visualization we would've kept tweaking the wrong things. ended up being a wasteful branch in the middle where it was calling the same lookup tool twice. being able to see the flow in realtime would've caught that in seconds instead of days of optimization guessing. the debug use case alone is worth it because tool call chains are genuinely hard to reason about after the fact when you only have logs.
1
jalfcolombia
•
7mo ago
Thank you so, so much for your contribution, it’s excellent. You did an amazing job, and this is incredibly helpful to me.
1
u/furiousrcj avatar
furiousrcj
•
7mo ago
I  added a fork for github copilot.Great work my friend!
1
Valunex
•
7mo ago
wow great job!
1
TriggerHydrant
•
7mo ago
Cool imma try this tomorrow!!
1
flaccidplumbus
•
7mo ago
This looks great!
1
tenggerion13
•
7mo ago
Looks quite futuristic and useful. Good job!

How does this work? What are the workflows?

Edit: I liked how that little green spark moves.
1
More posts you may like
Related posts
I built a VS Code extension that turns your Claude Code agents into pixel art characters working in a little office | Free & Open-source

r/ClaudeCode
•
8mo ago
I built a VS Code extension that turns your Claude Code agents into pixel art characters working in a little office | Free & Open-source
r/ClaudeCode - I built a VS Code extension that turns your Claude Code agents into pixel art characters working in a little office | Free & Open-source
1.3K upvotes · 92 comments
 u/ElementorOfficial avatar
ElementorOfficial
•
Ad
 
If you're using Claude, Codex, or Cursor to build WordPress sites, web creators are calling this the missing piece. Elementor MCP is the official integration built by Elementor. Connect in a few clicks and build real, editable Elementor structure from plain-language prompts. Free to start.
Thumbnail image: If you're using Claude, Codex, or Cursor to build WordPress sites, web creators are calling this the missing piece. Elementor MCP is the official integration built by Elementor. Connect in a few clicks and build real, editable Elementor structure from plain-language prompts. Free to start.
elementor.com
View More
thank god i'm not blind anymore. finally seeing exactly what claude code does in the background in real-time.

r/ClaudeCode
•
7mo ago
thank god i'm not blind anymore. finally seeing exactly what claude code does in the background in real-time.
r/ClaudeCode - thank god i'm not blind anymore. finally seeing exactly what claude code does in the background in real-time.
201 upvotes · 51 comments
My workflow as product and process owner

r/ClaudeCode
•
13d ago
My workflow as product and process owner
r/ClaudeCode - My workflow as product and process owner
224 upvotes · 77 comments
If there could be one spin-off show of one of the hashira’s past, which one would you want?

r/DemonSlayerAnime
•
3y ago
If there could be one spin-off show of one of the hashira’s past, which one would you want?
r/DemonSlayerAnime - If there could be one spin-off show of one of the hashira’s past, which one would you want?
1.1K upvotes · 282 comments
The Ultimate Guide to Google Flow Agent for AI Videos: Hidden features, pro tips, and the absolute best use cases.

r/promptingmagic
•
5mo ago
The Ultimate Guide to Google Flow Agent for AI Videos: Hidden features, pro tips, and the absolute best use cases.
r/promptingmagic - The Ultimate Guide to Google Flow Agent for AI Videos: Hidden features, pro tips, and the absolute best use cases.
21 upvotes · 6 comments
Claude Code built a plugin that visualizes the work Claude Code is doing as agents working in an office

r/ClaudeAI
•
9mo ago
Claude Code built a plugin that visualizes the work Claude Code is doing as agents working in an office
r/ClaudeAI - Claude Code built a plugin that visualizes the work Claude Code is doing as agents working in an office
203 upvotes · 15 comments
New in Claude Code: agent view.

r/ClaudeCode
•
5mo ago
New in Claude Code: agent view.
r/ClaudeCode - New in Claude Code: agent view.
531 upvotes · 91 comments
Agent flow Authentication

r/copilotstudio
•
1y ago
Agent flow Authentication
2 upvotes · 5 comments
I still don't understand this 'agentic workflow' thing

r/ClaudeCode
•
21d ago
I still don't understand this 'agentic workflow' thing
989 upvotes · 314 comments
I built a visual dashboard to manage AI agents, like playing a video game, but for work

r/SideProject
•
5mo ago
I built a visual dashboard to manage AI agents, like playing a video game, but for work
r/SideProject - I built a visual dashboard to manage AI agents, like playing a video game, but for work
4 upvotes · 2 comments
Salvador: Visualize the Universe with a Claude Skill

r/ClaudeCode
•
9mo ago
Salvador: Visualize the Universe with a Claude Skill
r/ClaudeCode - Salvador: Visualize the Universe with a Claude Skill
2 upvotes
Agent Flow

r/LocalLLaMA
•
1y ago
Agent Flow
14 upvotes · 6 comments
Lay outing human in the loop agentflow

r/copilotstudio
•
1y ago
Lay outing human in the loop agentflow
r/copilotstudio - Lay outing human in the loop agentflow
2 upvotes · 10 comments
My Claude Code workflow after months of daily use

r/ClaudeCode
•
2mo ago
My Claude Code workflow after months of daily use
r/ClaudeCode - My Claude Code workflow after months of daily use
548 upvotes · 103 comments
Open-source CLI tool for visualizing AI agent workflows and locating vulnerabilities in them.

r/LangChain
•
2y ago
Open-source CLI tool for visualizing AI agent workflows and locating vulnerabilities in them.
23 upvotes · 5 comments
Claude Platform on AWS (Coming Soon)

r/aws
•
6mo ago
Claude Platform on AWS (Coming Soon)
111 upvotes · 50 comments
What I Learned Experimenting with Adobe Firefly Boards AI Tools for Storyboarding
r/Design
•
8mo ago
What I Learned Experimenting with Adobe Firefly Boards AI Tools for Storyboarding
7 comments
What the hell is the difference between agent flows and a power automate flow including some AI Builder stuff?

r/copilotstudio
•
1y ago
What the hell is the difference between agent flows and a power automate flow including some AI Builder stuff?
18 upvotes · 10 comments
I let a Claude Code agent run growth for my side project for a week, behind a one-word approval gate. What worked, and what I had to block

r/AI_Agents
•
13d ago
I let a Claude Code agent run growth for my side project for a week, behind a one-word approval gate. What worked, and what I had to block
15 upvotes · 33 comments
Claude now creates interactive charts, diagrams and visualizations

r/ClaudeAI
•
7mo ago
Claude now creates interactive charts, diagrams and visualizations
r/ClaudeAI - Claude now creates interactive charts, diagrams and visualizations
1.3K upvotes · 94 comments
What tool have you built for yourself with Claude code that removes so much headache in your work or personal life?

r/ClaudeAI
•
18d ago
What tool have you built for yourself with Claude code that removes so much headache in your work or personal life?
1.2K upvotes · 600 comments
Claude Flow

r/ClaudeAI
•
1y ago
Claude Flow
6 upvotes · 9 comments
What does your current agent coding workflow looks like?

r/ClaudeCode
•
9d ago
What does your current agent coding workflow looks like?
6 upvotes · 17 comments
I read 17 papers on agentic AI workflows. Most Claude Code advice is measurably wrong

r/ClaudeAI
•
7mo ago
I read 17 papers on agentic AI workflows. Most Claude Code advice is measurably wrong
386 upvotes · 156 comments
Data Viz with help from Claude

r/ClaudeAI
•
2y ago
Data Viz with help from Claude
r/ClaudeAI - Data Viz with help from Claude
129 upvotes · 48 comments
VIEW POST IN

Русский
हिन्दी
Português (Brasil)
Tiếng Việt
简体中文
日本語
繁體中文
Français
See more
Home
Popular
News
Explore
Best of Reddit
Best of Reddit in Portuguese
Best of Reddit in German
Reddit Rules
Privacy Policy
User Agreement
Accessibility
Reddit, Inc. © 2026. All rights reserved.



https://github.com/pixel-agents-hq/pixel-agents

https://github.com/nyanko3141592/subagent-viewer

https://github.com/Caffa/Session-Character-Visualizer

https://mcpmarket.com/tools/skills/visualizing-subagents

GET ALL THESE LINKS TOO, and BRAINSTORM.


ONE CUSTOM USE CASE IS, I USE LOTS OF CLAUDE ACCS with ALIASES (claude-a, claude-b, claude-c) each with diff 20/100usd acc. Make sure no matter which I use, I wanna see what is happening on my laptop, agy as well. 
