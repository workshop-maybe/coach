// The "Request a collection" link (collections plan KTD9, R11): a new-issue page on the public
// collections repo, opened in the browser. The app makes no network call. While no repo is
// set the link stays hidden.

/** The public collections repo as "owner/repo", or null while there is none. */
export const COLLECTION_REQUESTS_REPO: string | null = null;

/** The prefilled new-issue page for a collection request on `repo`. */
export function collectionRequestUrl(repo: string): string {
  const query = new URLSearchParams({ template: "request-a-collection.yml", title: "Collection: " });
  return `https://github.com/${repo}/issues/new?${query.toString()}`;
}
