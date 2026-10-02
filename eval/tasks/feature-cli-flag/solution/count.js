const json = process.argv.includes("--json");

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  const lines = input.split("\n").filter((l) => l !== "").length;
  const words = input.split(/\s+/).filter(Boolean).length;
  const chars = input.length;
  // With --json, nothing but the object: the output is being parsed, and a friendly extra line is
  // what turns a machine-readable mode back into a human-readable one.
  if (json) {
    console.log(JSON.stringify({ lines, words, chars }));
    return;
  }
  console.log(`${lines} lines, ${words} words, ${chars} chars`);
});
