# Journal

This is _not_ a README. That is at [README.md](README.md), which contains the technical details of the app.

Much of this app was built in with the help of GPT-5.2. See the below session log for a step-by-step account of the process. Besides that, here also are some reflections first on the development of the product, as well as on the testing process.

## Session Log

TLDR: Development progressed from brainstorming and schema design, through CLI prototyping, to a Next.js web UI with exercise lifecycle management, markdown formatting, and natural conversation-based help flow.

- Allowed GPT-5.2 to brainstorm implementation ideas and finalise in [README.md](README.md). 
- Decided on OpenAI API for the choice of LLM.
- Decided to use OpenAI structured output format for the assistant's responses, and created [schema.json](schema.json) and [prompts.json](prompts.json) to define the schema and prompts.
- Defined propose excersise structure in [schema.json](schema.json).
- Decided to use separate bespoke renderers for each exercise type.
- Decided on Node.js for a simple tester CLI tool ([cli.mjs](cli.mjs), now deprecated).
- Updated [README.md](README.md) to reflect the above decisions and use mermaid for flowcharts.
- Decided on Next.js for the web UI, also using Tailwind CSS for styling ([web](web)).
- Created [web/app/page.js](web/app/page.js) and [web/app/api/chat/route.js](web/app/api/chat/route.js) to implement the web UI and API route.
- Implemented idea of "active exercise" and "clearing excersises"
- Deprecated CLI tool ([cli.mjs](cli.mjs)) in favor of web UI.
- Attempted `npm audit` but failed to resolve all vulnerabilities. 
- Attempted to prompt the model to drive the conversation to limited effect.
- Added onboarding flow to web UI.
- Fix user state persistince successfully.
- Allow LLM to format responses in markdown.
- Fix issue where problem text was being generated in the target language instead of the native language.
- Add response flags.
- Removed help button in favour of more natural conversation flow.
- Updated [README.md](README.md) to reflect the above changes.
- Add prompt to ask for help if stuck on an exercise.
- Render markdown correctly in excersise text.
- Update UI so chat and excersise panels can change size.

## Reflections

### Development

Development began with interviewing Thomas to understand some of his challenges in learning Spanish, and what features he would find most useful in this app. This helped inform the design of the app, and the features that were implemented. 

#### Inspiration

- In the olden days of large language models there once existed [https://github.com/JushBJJ/Mr.-Ranedeer-AI-Tutor](https://github.com/JushBJJ/Mr.-Ranedeer-AI-Tutor) which was essentially a huge JSON-formatted prompt that could "teach you anything". This opened up the posibility of an AI both teaching as well as knowing _what_ to teach. This was the basis for knowing that such an app was possible.
- I had previously worked on AI-generated learning excersises, specifically programming problems, at [https://github.com/PatrickJYKang/problem_generator](https://github.com/PatrickJYKang/problem_generator). This taught me a lot about the technicalities and implementation details of such an app even though it was implemented very differently back then.
- [https://x.com/tom_doerr/status/2001581161399611483](https://x.com/tom_doerr/status/2001581161399611483) was the first to introduce to me the concept of a single-thread chatbot where all conversations happen in one single thread. This opened a new door to how I could possibly make this app properly learn about the user and their progress.
- Duolingo, being the most successful language learning app, served as a good inspiration for many of the app's features, especially excersise types, although I obviously could not replicate them all, nor was I willing to send threatening push notifications to my users, which is a big part of the app's success.

#### Design

- Based on above references the app was designed as a single thread chatbot in which the chatbot can chat with the user about their progress as well as propose exercises and then help the user with said excersises.
- I did not design the GUI of the app, GPT 5.2 did. I did however design the flow of the app. This is as minimalistic as possible to avoid complexity and allow us to focus on the core features of the app.

### Testing

Testing mostly revealed the limitations (still) of LLMs not being able to follow very simple instructions. This eventually led to me having to switch models from `gpt-5-mini` to `gpt-5.2` (which is 7 times more expensive), which allowed me to successfully implement the features I desired. The objective functions of the app were all verified and were generally bug-free.

As for whether the app actually helps one learn Spanish, possibly so. [demo.txt](demo.txt) is a transcript of my conversation with the app (very badly formatted). It did propose meaningful excersises, stay in scope correctly, and (with some prompting) jump from topic to topic in a meaningful way. In that sense the core features of the app are working as intended. It can only really however help the user practice, based on workable constraints, Spanish, and not teach; not that this was ever the goal.

Thomas could not be here for testing because of how tight the development timeline was but Sr. Ayala was.

## Next Steps

### Technical

- Implement streaming responses [https://platform.openai.com/docs/guides/streaming-responses](https://platform.openai.com/docs/guides/streaming-responses) for professionalism and aesthetic value.
- Fix GUIs and renderers of excersises to be more aesthetically pleasing.
- Fix multiple choice problems that don't work.
- Better proactivity from the LLM.

### Features

- More variety of excersises (steal from Duolingo).
- Ability to follow curriculum (see [https://github.com/PatrickJYKang/problem_generator](https://github.com/PatrickJYKang/problem_generator) for my previous work on this).
- Potential integration with Canvas/Google Classroom/teachers to get up to date on progress.
- Or even further integration to use as an actual learning tool for teachers to assign (would need massive reliability overhauls).
