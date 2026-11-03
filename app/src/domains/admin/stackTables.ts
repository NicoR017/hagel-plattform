/** Labels the cells of every table of the section with their column name (CSS shows them as cards on a phone); the calculation grids (`mtab`) stay tables. */
export function stackTables(root: HTMLElement) {
  root.querySelectorAll("table").forEach((tb) => {
    if (tb.classList.contains("mtab")) return;
    tb.classList.add("stack");
    const heads = Array.from(tb.querySelectorAll("thead th")).map((th) => (th.textContent ?? "").trim());
    tb.querySelectorAll("tr").forEach((tr) => {
      if (tr.parentElement?.tagName === "THEAD") return;
      let col = 0;
      Array.from(tr.children).forEach((c, i, all) => {
        const el = c as HTMLElement, span = Number(el.getAttribute("colspan") ?? 1);
        if (span > 1) el.classList.add("wide");
        else if (heads[col] && el.getAttribute("data-label") !== heads[col]) el.setAttribute("data-label", heads[col]);
        if (i === all.length - 1 && i > 0 && el.querySelector("button, a.btn")) el.classList.add("act");
        col += span;
      });
    });
  });
}
