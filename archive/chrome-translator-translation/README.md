# Archived Chrome Translator Translation

This directory preserves the former Chrome native Translator API route, shown in the popup as “Gemini Nano.” It was disconnected because API availability and compatibility were not dependable enough for the active translation pipeline.

Nothing in `src/` may import this directory. Active translation routes are Google Translate, WebLLM, and any separately implemented external API engines.

To revisit this experiment, restore the engine, its language detector, explicit `TranslationManager` routing, popup catalog entry, persisted-state allow-list, and native API coverage before exposing the tier again.
