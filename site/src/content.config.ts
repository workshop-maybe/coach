// The guide collection (U2, KTD1, R13): one MDX page per file under content/guide, in
// four parts. A page's entry id is its path without the extension (how-to/export), and
// that id is its address (/how-to/export/). The page's title is its one h1, so the body
// starts below it.

import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";
import { PART_IDS } from "./parts";

const guide = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/guide" }),
  schema: z.object({
    /** The page's heading and its tab title. No closing period (R12). */
    title: z.string().min(1),
    /** Which part navigation lists it under. */
    part: z.enum(PART_IDS),
    /** Its place within the part, lowest first. */
    order: z.number().int(),
    /** One line on what the page is for, used as the page's meta description and on the home page. */
    description: z.string().min(1),
  }),
});

export const collections = { guide };
