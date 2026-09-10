let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  const lines = input.split("\n").filter((l) => l !== "").length;
  const words = input.split(/\s+/).filter(Boolean).length;
  const chars = input.length;
  console.log(`${lines} lines, ${words} words, ${chars} chars`);
});
