// Synthetic stand-in for LinkedIn's SDUI form behaviour, for tests only.
function labelOf(el) {
  const label = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
  if (label) return label.textContent.replace("*", "").trim();
  return (el.closest("[aria-label]") || el).getAttribute("aria-label") || el.getAttribute("role");
}

function valuesOf(dialog) {
  const out = {};
  for (const el of dialog.querySelectorAll("input, select, [contenteditable]")) {
    if (el.closest("[hidden]")) continue;
    out[labelOf(el)] =
      el.type === "checkbox" ? el.checked
      : el.isContentEditable ? el.innerText
      : el.tagName === "SELECT" ? el.selectedOptions[0].textContent
      : el.value;
  }
  return out;
}

document.addEventListener("click", async (event) => {
  const option = event.target.closest('[role="option"]');
  if (option) {
    const input = option.closest("[data-typeahead]").querySelector("input");
    input.value = option.textContent;
    option.parentElement.remove();
    return;
  }
  const button = event.target.closest("button");
  if (!button) return;
  const dialog = button.closest("dialog");
  const action = button.dataset.action;
  if (action === "save") {
    await fetch("/__save", { method: "POST", body: JSON.stringify(valuesOf(dialog)) });
    dialog.close();
  }
  if (action === "edit") document.getElementById(button.dataset.dialog).showModal();
  if (action === "delete") document.getElementById("confirm").showModal();
  if (action === "confirm-delete") {
    await fetch("/__delete", { method: "POST" });
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
