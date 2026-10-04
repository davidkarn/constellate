- Keep comments to a margin of 80 characters
- Try to keep a margin of around ~90 characters
- Prefer to use explicit else if and else cases instead of early returns, ideally every branch of if/else cases should end in a return (or break or continue or throw) where possible. This can be ignored for highly imperative code such as controllers and cli jobs or where it would result in uglier code.
- Use .length > 0 and .length === 0 instead of .length or !.length
- Do not use ~ or ^ in package.json, always refer to exact versions

- Utiliize the functional core/imperative shell pattern where possible, by separating calculation logic into pure functions and handling side-effects, i/o, and other actions / events in content script/background service functions that receive events/process data, then call calculation functions to determine what changes need to be made, then make those changes.
- Utilize helper functions in src/lib.ts to handle common tasks on common data types such as arrays, objects, maps, dates, and sets.
- Create new helper functions when there is a likelyhood that the behavior will need to be used repeatedly and the behavior is generic.
- Prefer match() from ts-pattern over chained ternaries, in order to preserve a sequential reading of the possible cases.


