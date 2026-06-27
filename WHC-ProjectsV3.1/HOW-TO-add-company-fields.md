# Adding company-specific proposal fields

Each company (WHC, Moonway, WH Safety & Fire) keeps its own separate data —
quotations, projects, numbering, and summaries never mix. The company is chosen
at login and locked for that session.

By default, all three companies use **WHC's proposal field set**, so the two new
companies work immediately. When you're ready to give Moonway or WH Safety & Fire
their own fields, you only edit ONE place.

## Where

Open `proposals/proposals-quotation.js` and find:

```js
const COMPANY_FIELD_OVERRIDES = {
  // "mw":  function(baseGroups, category) { ... },
  // "whsf": function(baseGroups, category) { ... },
};
```

Company ids:
- `whc`  = Winner Holistic Consultant   (uses the base set; usually leave as-is)
- `mw`   = Moonway General Contracting
- `whsf` = WH Safety and Fire

## How

Uncomment the relevant block and modify the `baseGroups` array (a deep copy, so
you can freely change it). Each group looks like:

```js
{ group: "Project Details", fields: [ {field}, {field}, ... ] }
```

Each field looks like:

```js
{ id: "unique_key", label: "Shown Label", type: "text", required: true }
```

Field `type` can be: `text`, `number`, `date`, `textarea`, `select`
(with `options: [...]`), or `datalist` (with `list: [...]`). Add `full: true`
to make a field span the full width.

### Add a field
```js
"mw": function(baseGroups, category) {
  const g = baseGroups.find(x => x.group === "Project Details");
  if (g) g.fields.push({ id: "mw_permit_no", label: "Municipality Permit No.", type: "text" });
  return baseGroups;
}
```

### Add a whole new group
```js
"whsf": function(baseGroups, category) {
  baseGroups.push({ group: "Fire & Safety", fields: [
    { id: "civil_defence_ref", label: "Civil Defence Ref", type: "text" },
    { id: "system_type", label: "System Type", type: "select",
      options: ["Fire Alarm","Sprinkler","Suppression","Other"] }
  ]});
  return baseGroups;
}
```

### Remove a field for a company
```js
"mw": function(baseGroups, category) {
  const g = baseGroups.find(x => x.group === "Client Details");
  if (g) g.fields = g.fields.filter(f => f.id !== "some_field_id");
  return baseGroups;
}
```

The function always receives a fresh copy and must `return baseGroups;`.
If it errors, the app safely falls back to the base WHC set.

You can also vary fields by `category` (the second argument) — e.g. only add a
field for the "Fitout Folder" category.
