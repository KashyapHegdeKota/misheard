/** A site-root-relative path from the data ("audio/ES2002a_0412.mp3") as a URL
 *  ("/audio/ES2002a_0412.mp3"), whether or not the pipeline wrote a leading slash. */
export const publicUrl = (path: string) => `/${path.replace(/^\/+/, "")}`;
