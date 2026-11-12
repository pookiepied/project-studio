---
name: visual-responses
description: The formats for charts, stats, progress bars, timelines, cards, and places maps that Studio draws inside a reply. Activate before writing any of them.
---

# Visual responses

Studio can draw six kinds of visual inside your reply. To use one, write a
fenced code block with the visual's name as the language, and put one JSON
object inside it. Studio draws it. You do not choose colors, fonts, or sizes.

Rules for every visual:

- The JSON must be valid: double quotes, no comments, no trailing commas.
- Use data from the conversation, your tools, or your sources. Never invent
  numbers, dates, ratings, or sources. Label supplied estimates as estimates
  in the subtitle or accompanying text. User-proposed plans can use their
  intended dates or stages; do not present them as completed events.
- Introduce the visual briefly and explain the conclusion in your text.
  Keep evidence, tradeoffs, and limitations that matter to the user's decision.
  Do not repeat every visual item in prose.
- Use the matching visual for the cases in the system prompt's Visuals section.
  Do not wait for the user to request it. Use at most one visual for each
  distinct point, and respect requests for plain text or a specific format.
- Use only the fence names below, with one JSON object per fence. Write it
  at the top level of your reply and close the fence.
- Before sending, check the JSON, required fields, units, and source data.
  The sample values and addresses below demonstrate the format; they are not
  verified facts to reuse in an answer.

## Which visual to use

| The content | Use |
| --- | --- |
| Values over time (days, months, years) | `chart` with type `line`, or `area` for a total |
| Values for a few categories side by side | `chart` with type `column` |
| A ranking, or categories with long names | `chart` with type `bar` |
| Two to four key figures | `stats` |
| How complete several parts of a task are | `progress` |
| A schedule, history, or plan with several dates or stages | `timeline` |
| Products, places, or options to choose from | `cards` |
| Where places are and how they relate spatially | `map` |

## chart

```chart
{
  "type": "line",
  "title": "Monthly active users",
  "subtitle": "January to June 2026",
  "x": ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
  "series": [
    { "name": "iOS", "values": [12.1, 13.4, 15.0, 16.2, 18.9, 21.3] },
    { "name": "Android", "values": [9.8, 10.2, 11.1, 12.7, 13.0, 14.4] }
  ],
  "unit": "K",
  "source": "Company Q2 report"
}
```

- `type` is `line`, `area`, `column`, or `bar`. The default is `line`.
- `x` holds the labels. Each series has exactly one value for each label.
- Use `null` for a missing value. Do not guess it.
- Use at most 8 series. Fewer is easier to read.
- Use one unit for the whole chart. If you have two measures with different
  units, make two charts.
- `unit` is optional. A currency symbol (dollars, euros, pounds) is shown before the
  number. Anything else (`%`, `K`, `ms`, `kg`) is shown after it.
- `title`, `subtitle`, and `source` are optional. Give a title.

For one series, you can use `data` instead of `x` and `series`:

```chart
{
  "type": "bar",
  "title": "Most loved languages",
  "unit": "%",
  "data": [
    { "label": "Rust", "value": 83 },
    { "label": "Elixir", "value": 73 },
    { "label": "TypeScript", "value": 69 }
  ]
}
```

## stats

```stats
{
  "title": "Q2 results",
  "items": [
    { "label": "Revenue", "value": "$4.2M", "delta": "+12%", "note": "vs Q1" },
    { "label": "Churn", "value": "2.1%", "delta": "-0.4pt", "good": "down" },
    { "label": "Customers", "value": "1,284" }
  ]
}
```

- Use two to four items.
- `value` is the figure as the user should read it, with its unit.
- `delta` is optional. Start it with `+` or `-`.
- `good` says which direction is good news: `up` (the default), `down` (for
  costs, churn, errors), or `neither`.
- `note` is optional, for example the period the delta compares against.

## progress

```progress
{
  "title": "Migration",
  "items": [
    { "label": "Database", "value": 100 },
    { "label": "API routes", "value": 34, "max": 52, "note": "18 left" }
  ]
}
```

- `max` is optional and defaults to 100. Without it, `value` is a percentage.
- Use measured counts or percentages. If you only know task states such as
  started or blocked, report them in text rather than guessing a percentage.

## timeline

```timeline
{
  "title": "Release plan",
  "items": [
    { "date": "Mar 4", "title": "Beta", "status": "done" },
    { "date": "Apr 15", "title": "Public launch", "status": "current", "detail": "Waitlist opens first" },
    { "date": "June", "title": "Version 2", "status": "upcoming" }
  ]
}
```

- `status` is `done`, `current`, or `upcoming`. The default is `upcoming`.
- `date` and `detail` are optional.

## cards

```cards
{
  "title": "Three headphones to consider",
  "items": [
    {
      "title": "Sony WH-1000XM6",
      "subtitle": "Over-ear, noise cancelling",
      "image": "https://example.com/xm6.jpg",
      "url": "https://example.com/xm6",
      "price": "$399",
      "rating": 4.7,
      "tags": ["Best noise cancelling"],
      "detail": "Strongest noise cancelling of the three. Also the heaviest."
    }
  ]
}
```

- Use two to six cards. Only `title` is required.
- `image` is a web address you found, or the path of a picture saved in this
  conversation's files, such as `workspace/photo.png`. If you do not have a
  real address, leave `image` out.
- Include a relevant picture when one is available from the user's files or
  retrieved sources. A product page address is not an image address. Do not
  guess an image address or use a generated picture as a real product photo.
- `url` is the page the card links to. It opens in the user's browser.
- Include the source page when available. Keep the recommendation and key
  tradeoffs in the surrounding text. Use a table instead when the user mainly
  needs to compare many exact attributes across the options.
- `rating` is a number from 0 to 5.
- `tags` holds at most four short labels.

## map

```map
{
  "title": "Survey locations",
  "subtitle": "Coordinates from the supplied dataset",
  "places": [
    { "name": "Sample point A", "lat": 23.81, "lng": 90.41, "detail": "First observation site" },
    { "name": "Sample point B", "lat": 23.79, "lng": 90.43, "detail": "Second observation site" }
  ]
}
```

- Supply one to twelve places. Each has a name and numeric `lat` and `lng`
  in decimal degrees. Latitude must be within ±85°, longitude within ±180°.
- Use coordinates supplied by the person, present in their data, or verified
  against a source. Omit a pin whose coordinates you cannot establish and say
  which place was omitted. If none are known, answer in text.
- Use `detail` for a short explanation and cite sources in the surrounding
  reply. The basemap gives context, and the pins are the data in your reply.
- Use this format for pins. For a requested walking route, call
  `walking_route` with two to five named stops in the user's order and
  reliable numeric coordinates. Studio displays the returned route and
  estimated times directly, so there is no map fence to copy. If a stop's
  coordinates are missing, ask for them. If the provider or permission
  prevents the route, explain that outcome without drawing a substitute.

## Pictures you made yourself

If you saved a picture to a file, for example a plot made with code, show it
with normal Markdown: `![Revenue by month](workspace/revenue.png)`.
If you have the numbers, use a `chart` instead. It matches the app, works in
light and dark mode, and the user can view it as a table.

## If a visual does not appear

If the JSON is invalid, Studio shows it as code with the reason. If the user
or a tool reports that a visual failed, correct the format rather than repeat
the invalid block. You cannot assume a visual rendered successfully merely
because you wrote its fence.
