// Pi's codemode tool in `only` mode: the model is given codemode alone and reaches every
// other tool from its scripts. Registering `codemode` replaces Pi's built-in codemode
// extension (pi-coding-agent's builtInExtensions marks it replaceable), which Pi reports
// once on stderr; Pi's CLI reads `codemode.mode` only from user settings, which quin
// leaves to the user.
import { createCodemodeExtension } from "@earendil-works/pi-coding-agent";

export default createCodemodeExtension({ mode: "only" });
