# Layout recipes

Common slide compositions expressed in slideglance grammar. Start from
the closest recipe and replace content.

## Choosing a layout strategy

| System                                        | When to reach for it                                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `<VStack>` / `<HStack>` (Flexbox flow)        | Default for any one-axis flow. Most slide content.                                                      |
| `position="absolute"` inside a flow container | Single overlay anchored to a flow container's bounds (e.g. corner page number).                         |
| `<Layer>` + child `x` / `y`                   | Multiple overlapping elements with arbitrary positions. Diagrams, infographics, freely composed scenes. |
| `<Line>` with `x1` / `y1` / `x2` / `y2`       | A straight line between two specific points (parent-absolute coordinates).                              |

Within a single `<Layer>`, prefer `x` / `y` over `position="absolute"`.

## 1 — Cover (title slide)

```xml
<Slide master="COVER">
  <VStack padding="80" justifyContent="center" gap="16" h="max">
    <Text fontSize="14" color="64748B">QUARTERLY REVIEW</Text>
    <Text fontSize="68" bold="true" color="0F172A" lineHeight="1.05">
      The year we picked depth over reach.
    </Text>
    <Text fontSize="20" color="1F2937" lineHeight="1.4" w="800">
      2026 product report from the platform team.
    </Text>
  </VStack>
</Slide>
```

## 2 — Title + body (single column)

```xml
<Slide>
  <VStack class="page" gap="20">
    <Text class="title">What we shipped</Text>
    <Text class="muted">Three changes that bent the curve.</Text>
    <Ul fontSize="20" class="body">
      <Li>Edge cache hit rate: 71 → 89%.</Li>
      <Li>P95 cold-start: 1.4s → 380ms.</Li>
      <Li>Build minutes per PR: 18 → 7.</Li>
    </Ul>
  </VStack>
</Slide>
```

The workhorse layout. Almost every scenario deck uses this for
content slides.

## 3 — Two-column (HStack 50 / 50)

```xml
<Slide>
  <HStack class="page" gap="48">
    <VStack w="50%" gap="12">
      <Text class="title">What changed</Text>
      <Text class="body">
        Replaced the per-request worker pool with a long-lived event
        loop. Cold-start dropped from 1.4s to under 400ms.
      </Text>
    </VStack>
    <VStack w="50%" gap="12">
      <Image src="./assets/before-after.png" w="100%" />
      <Text fontSize="12" color="64748B" textAlign="center">
        Cold-start P95 over the rollout window.
      </Text>
    </VStack>
  </HStack>
</Slide>
```

For asymmetric splits (60 / 40, 70 / 30), set explicit `w="60%"` on
the primary column. `flexGrow` is not in the schema — use percentage
widths or `w="max"` on one column.

## 4 — KPI grid

```xml
<Templates>
  <Template name="kpi" params="label,value,delta,tone">
    <VStack w="240" padding="20" gap="6"
            backgroundColor="FFFFFF"
            border.color="E2E8F0" border.width="1"
            borderRadius="8">
      <Text fontSize="12" color="64748B">{label}</Text>
      <Text fontSize="36" bold="true" color="0F172A">{value}</Text>
      <Text fontSize="13" color="{tone}">{delta}</Text>
    </VStack>
  </Template>
</Templates>

<Slide>
  <VStack class="page" gap="24">
    <Text class="title">Q4 in numbers</Text>
    <HStack gap="16">
      <Use template="kpi" label="ARR" value="$48.2M" delta="+22% YoY" tone="16A34A" />
      <Use template="kpi" label="Net retention" value="118%" delta="+4pp QoQ" tone="16A34A" />
      <Use template="kpi" label="P95 cold-start" value="380ms" delta="−73% QoQ" tone="16A34A" />
    </HStack>
  </VStack>
</Slide>
```

> **Equal-share variant** — omit `w` on the `kpi` template (and on every
> sibling inside the `<HStack>`) to get the row to auto-distribute the
> available width equally. `<HStack gap="…" alignItems="stretch">` + no
> explicit `w` on the children is the simplest "fill row with N equal
> cards" idiom; `flexGrow` is unnecessary for the equal-share case.

## 5 — Quote / pullquote

```xml
<Slide>
  <VStack class="page" justifyContent="center" alignItems="center" h="max" gap="24" padding="120">
    <Text fontSize="48" lineHeight="1.25" textAlign="center" color="0F172A"
          fontFamily="Georgia" italic="true">
      "The work that defines whether a release was good
      is the year that follows it."
    </Text>
    <Text fontSize="13" color="64748B">Mara Olsen, 2026 retrospective</Text>
  </VStack>
</Slide>
```

## 6 — Timeline (Foreach + Template)

```xml
<Templates>
  <Template name="timelineRow" params="date,label,tone,body,isLast">
    <HStack gap="20" alignItems="start">
      <VStack alignItems="center" gap="0" w="80">
        <Shape shapeType="ellipse" w="14" h="14" fill.color="{tone}" />
        <If test="!isLast">
          <VStack w="2" h="80" backgroundColor="E2E8F0" />
        </If>
      </VStack>
      <VStack gap="4">
        <Text fontSize="14" bold="true" color="{tone}">{date}</Text>
        <Text fontSize="18" bold="true" color="0F172A">{label}</Text>
        <Text fontSize="14" color="475569">{body}</Text>
      </VStack>
    </HStack>
  </Template>
</Templates>

<Slide>
  <VStack class="page" gap="16">
    <Text class="title">Rollout timeline</Text>
    <Foreach items='[
      {"date":"Jan","label":"Behind a flag","tone":"6B7280","body":"Internal-only, 1% sampling."},
      {"date":"Feb","label":"Friendly cohort","tone":"1D4ED8","body":"50 design-partner orgs."},
      {"date":"Mar","label":"GA","tone":"16A34A","body":"Open enrollment, default-on for new orgs."}
    ]' as="m" lastAs="isLast">
      <Use template="timelineRow"
           date="{m.date}" label="{m.label}" tone="{m.tone}" body="{m.body}"
           isLast="{isLast}" />
    </Foreach>
  </VStack>
</Slide>
```

## 7 — Table (data-heavy)

```xml
<Slide>
  <VStack class="page" gap="16">
    <Text class="title">Rollout cohorts</Text>
    <Table defaultRowHeight="36" cellBorder.color="CBD5E1" cellBorder.width="1">
      <Col w="160" />
      <Col w="100" />
      <Col w="120" />

      <Tr>
        <Td class="th">Cohort</Td>
        <Td class="th">Org count</Td>
        <Td class="th">P95</Td>
      </Tr>
      <Tr>
        <Td>Internal</Td>
        <Td>1</Td>
        <Td>410ms</Td>
      </Tr>
    </Table>
  </VStack>
</Slide>
```

Use `<Styles>` for `class="th"` to keep per-cell markup tight. `<Td>`
accepts both `padding` and `margin` as aliases for the cell's inner
spacing (PPTX table cells have no outer-spacing concept — see
[`schema-gotchas.md`](./schema-gotchas.md) §"`<Td>` `padding` /
`margin`"). When both are present, `padding` wins.

## 8 — Diagram (Layer + Shape + Line)

```xml
<Slide>
  <Layer w="1280" h="720">
    <Shape shapeType="rect" x="0" y="0" w="1280" h="80" fill.color="0F172A" />
    <Text  x="48" y="24" w="600" fontSize="28" bold="true" color="FFFFFF">System overview</Text>

    <Shape shapeType="roundRect" x="120" y="220" w="240" h="120"
           fill.color="DBEAFE" line.color="1D4ED8" line.width="2"
           fontSize="18" bold="true" color="1D4ED8" textAlign="center">Ingest</Shape>
    <Shape shapeType="roundRect" x="520" y="220" w="240" h="120"
           fill.color="FEF3C7" line.color="D97706" line.width="2"
           fontSize="18" bold="true" color="D97706" textAlign="center">Process</Shape>

    <Line x1="360" y1="280" x2="520" y2="280" lineWidth="2"
          color="334155" endArrow.type="triangle" />
  </Layer>
</Slide>
```

> Reading order in PowerPoint follows document source order, not
> visual position. Place decorative backgrounds first, informational
> shapes last. Mark backgrounds `isDecorative="true"`.

## 9 — Chart slide

```xml
<Slide>
  <VStack class="page" gap="16">
    <Text class="title">Quarterly revenue</Text>
    <Chart chartType="bar" w="1000" h="420"
           showTitle="false"
           showLegend="true" legendPos="bottom">
      <ChartSeries name="2025">
        <ChartDataPoint label="Q1" value="120" />
        <ChartDataPoint label="Q2" value="135" />
        <ChartDataPoint label="Q3" value="148" />
      </ChartSeries>
    </Chart>
  </VStack>
</Slide>
```

`chartType` supports `bar`, `line`, `pie`, `area`, `doughnut`, `radar`.

## 10 — Section divider

```xml
<Slide master="DARK">
  <VStack padding="120" justifyContent="center" h="max" gap="16">
    <Text fontSize="14" color="94A3B8">PART TWO</Text>
    <Text fontSize="80" bold="true" color="FFFFFF" lineHeight="1.05">
      What we learned.
    </Text>
  </VStack>
</Slide>
```

## 11 — Vertical card (3:4 / 9:16 for social)

```xml
<Document size="custom" w="960" h="1280" />
```

> **Pitfall**: `<Document>` cannot accept both `size="..."` and
> `w/h` — use one or the other. Drop `size="custom"` and provide
> only `w` / `h`.

```xml
<Slide>
  <VStack padding="64" gap="20" h="max" backgroundColor="FEF8F1">
    <Text fontSize="11" color="C2410C">01 · SLOW LIVING</Text>
    <Text fontSize="56" bold="true" color="431407" lineHeight="1.05" fontFamily="Playfair Display">
      The morning you don't owe anyone.
    </Text>
    <Image src="./assets/coffee.jpg" w="100%" sizing.type="cover" h="540" borderRadius="24" />
  </VStack>
</Slide>
```

## Layout-rule summary

- **One root child per `<Slide>`.** Almost always `<VStack>`, `<HStack>`, or `<Layer>`.
- **Reach for `<Layer>` only for diagrams / infographics.** Flex containers handle 90% of slide content.
- **Reading order = source order.** Critical when using `<Layer>` for accessibility.
- **Promote repeated patterns to `<Templates>` after 2 occurrences.** Beyond that, the lint catches `HARDCODED_COLOR` repetition.
- **Use percentage widths inside `<HStack>` columns.** `w="50%"` works; `w="max"` on a single column works. `flexGrow` does not exist in the schema.
