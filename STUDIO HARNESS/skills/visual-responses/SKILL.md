---
name: visual-responses
description: The formats for charts, stats, progress bars, timelines and product cards that Studio draws inside a reply. Activate before writing any of them.
---

# Visual responses

Studio can draw five kinds of visual inside your reply. To use one, write a
fenced code block with the visual's name as the language, and put one JSON
object inside it. Studio draws it. You do not choose colors, fonts, or sizes.

Rules for every visual:

- The JSON must be valid: double quotes, no comments, no trailing commas.
- Use only real data from the conversation, your tools, or your sources.
  Never invent numbers. If numbers are estimates, say so in the subtitle.
- Write one or two sentences of text before the visual that say what it shows.
  Put any conclusion in your text, not only in the visual.
- Use at most one visual for each point you make. Most replies need none.

## Which visual to use

| The content | Use |
| --- | --- |
| Values over time (days, months, years) | `chart` with type `line`, or `area` for a total |
| Values for a few categories side by side | `chart` with type `column` |
| A ranking, or categories with long names | `chart` with type `bar` |
| Two to four key figures | `stats` |
| How complete several parts of a task are | `progress` |
| Events or stages in order, with dates | `timeline` |
| Products, places, or options to choose from | `cards` |

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
- `url` is the page the card links to. It opens in the user's browser.
- `rating` is a number from 0 to 5.
- `tags` holds at most four short labels.

## Pictures you made yourself

If you saved a picture to a file, for example a plot made with code, show it
with normal Markdown: `![Revenue by month](workspace/revenue.png)`.
If you have the numbers, use a `chart` instead. It matches the app, works in
light and dark mode, and the user can view it as a table.

## If a visual does not appear

If the JSON is invalid, Studio shows it as code with the reason. Fix the JSON
in your next reply only if the user asks about it.
