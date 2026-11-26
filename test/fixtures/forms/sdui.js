// Synthetic stand-in for LinkedIn's SDUI form behaviour, for tests only.
function labelOf(el) {
  const label = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
  if (label) return label.textContent.replace("*", "").trim();
  return (el.closest("[aria-label]") || el).getAttribute("aria-label") || el.getAttribute("role");
}

function valuesOf(dialog) {
  const out = {};
  for (const el of dialog.querySelectorAll("input, select, textarea, [contenteditable]")) {
    if (el.closest("[hidden]")) continue;
    out[labelOf(el)] =
      el.type === "checkbox" ? el.checked
      : el.isContentEditable ? el.innerText
      : el.tagName === "SELECT" ? el.selectedOptions[0].textContent
      : el.value;
  }
  return out;
}

// The dialog an "edit" button opened, so a delete can say which entry it removed.
let editing = "";

document.addEventListener("click", async (event) => {
  const option = event.target.closest('[role="option"]');
  if (option) {
    const input = option.closest("[data-typeahead]").querySelector("input");
    input.value = option.textContent;
    option.parentElement.remove();
    return;
  }
  const button = event.target.closest("button, a");
  if (!button) return;
  const dialog = button.closest("dialog");
  const action = button.dataset.action;
  if (action === "save") {
    await fetch("/__save", { method: "POST", body: JSON.stringify(valuesOf(dialog)) });
    dialog.close();
  }
  if (action === "edit") {
    editing = button.dataset.dialog;
    document.getElementById(editing).showModal();
  }
  if (action === "delete") document.getElementById("confirm").showModal();
  if (action === "confirm-delete") {
    await fetch("/__delete", { method: "POST", body: editing });
    for (const d of document.querySelectorAll("dialog")) d.close();
  }
});

// Typeaheads offer the typed text as their only suggestion.
document.addEventListener("input", (event) => {
  const box = event.target.closest("[data-typeahead]");
  if (!box) return;
  box.querySelector('[role="listbox"]')?.remove();
  const list = document.createElement("ul");
  list.setAttribute("role", "listbox");
  list.innerHTML = `<li role="option"></li>`;
  list.firstChild.textContent = event.target.value;
  box.append(list);
});

// "Currently working here" hides the end date.
document.addEventListener("change", (event) => {
  const current = event.target.closest("[data-current]");
  if (current) document.getElementById("end-date").hidden = event.target.checked;
});

// Date selects: a "Month"/"Year" placeholder, then the choices.
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
for (const select of document.querySelectorAll("select[data-months]")) {
  for (const label of ["Month", ...MONTHS]) select.add(new Option(label));
}
for (const select of document.querySelectorAll("select[data-years]")) {
  select.add(new Option("Year"));
  for (let year = 2030; year >= 1990; year--) select.add(new Option(String(year)));
}
