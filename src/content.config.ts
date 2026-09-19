import { defineCollection, z } from 'astro:content';
import { file } from 'astro/loaders';

const work = defineCollection({
  loader: file('src/content/work.json'),
  schema: z.object({
    client: z.string(),
    discipline: z.string(),
    year: z.string(),
  }),
});

const capabilities = defineCollection({
  loader: file('src/content/capabilities.json'),
  schema: z.object({
    ground: z.enum(['capability--paper', 'capability--ink', 'capability--stone']),
    title: z.string(),
    body: z.string(),
    mark: z.enum(['circles', 'squares', 'grid']),
  }),
});

const journal = defineCollection({
  loader: file('src/content/journal.json'),
  schema: z.object({
    category: z.string(),
    date: z.string(),
    title: z.string(),
    abstract: z.string().optional(),
    url: z.string().optional(),
    featured: z.boolean().optional(),
  }),
});

export const collections = { work, capabilities, journal };
