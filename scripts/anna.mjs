import { annaCommand, run } from './lib.mjs';
const [command, args] = annaCommand(process.argv.slice(2));
await run(command, args);
