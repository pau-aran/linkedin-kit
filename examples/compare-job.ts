// Replace the keywords and location, then run: lk run examples/compare-job.ts
// For a known job ID, skip the search and pass that ID directly to li.jobs.get.
declare const li: import("../src/li.ts").Li;

// @ts-expect-error lk run wraps this script in an async function body.
return (async () => {
  const [match] = await li.jobs.search({ keywords: "platform engineer", location: "Spain", limit: 3 });
  if (!match) return { message: "No jobs matched the search" };
  return { profile: await li.profile.get(), job: await li.jobs.get(match.id) };
})();
