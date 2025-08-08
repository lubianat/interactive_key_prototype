async function init() {

    const UNKNOWN_VALUE = "__unknown__";
    const UNKNOWN_LABEL = "Outro/Não registrado";

    document.getElementById("appTitle").textContent = specs.title;
    document.getElementById("meta").textContent = `v${specs.version}`;

    const cardsContainer = document.getElementById("cards");
    const emptyEl = document.getElementById("empty");
    const clearBtn = document.getElementById("clearBtn");
    const collapseAllBtn = document.getElementById("collapseAllBtn");
    const searchInput = document.getElementById("search");
    const activeFiltersWrap = document.getElementById("activeFilters");
    const sortModeSelect = document.getElementById("sortMode");

    // Cache to avoid duplicate network calls
    const wikidataImageCache = new Map();

    // Sorting state
    let filterSortMode = "alpha";
    const fieldsetRefs = {};
    const sectionInners = {};

    async function getWikidataImageURL(qid, width = 640) {
        if (!qid) return null;
        if (wikidataImageCache.has(qid)) return wikidataImageCache.get(qid);

        const url = `https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`;
        const resp = await fetch(url);
        if (!resp.ok) return null;
        const json = await resp.json();

        const entity = json.entities?.[qid];
        const p18 = entity?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
        if (!p18) {
            wikidataImageCache.set(qid, null);
            return null;
        }

        const filename = encodeURIComponent(p18);
        const filePath = `https://commons.wikimedia.org/wiki/Special:FilePath/${filename}?width=${width}`;

        wikidataImageCache.set(qid, filePath);
        return filePath;
    }

    async function hydrateImagesFromWikidata(items) {
        await Promise.all(items.map(async (it) => {
            const url = await getWikidataImageURL(it.wikidata);
            if (url) it.image = url;
        }));
    }

    // Build trait map
    const traitMap = {};
    data.forEach((item) => {
        Object.entries(item.traits).forEach(([cls, descriptors]) => {
            if (!traitMap[cls]) traitMap[cls] = {};
            Object.entries(descriptors).forEach(([desc, qual]) => {
                if (!traitMap[cls][desc]) traitMap[cls][desc] = new Set();
                traitMap[cls][desc].add(qual);
            });
        });
    });

    let selectedFilters = {};
    const radioInfoList = [];

    function saveStateToHash() {
        const state = { selectedFilters, q: searchInput.value, sort: filterSortMode };
        location.hash = encodeURIComponent(JSON.stringify(state));
    }
    function loadStateFromHash() {
        try {
            if (location.hash.length > 1) {
                const state = JSON.parse(decodeURIComponent(location.hash.slice(1)));
                selectedFilters = state.selectedFilters || {};
                const q = state.q || '';
                searchInput.value = q;
                filterSortMode = state.sort || "alpha";
            }
        } catch (_) { }
    }

    function buildFilters() {
        const container = document.getElementById("filters");
        const toc = document.getElementById("toc");

        Object.keys(traitMap)
            .sort()
            .forEach((cls) => {
                const anchorLink = document.createElement("a");
                anchorLink.href = `#sec-${cls}`;
                anchorLink.textContent = cls;
                toc.appendChild(anchorLink);

                const section = document.createElement("section");
                section.id = `sec-${cls}`;

                const header = document.createElement("h3");
                header.textContent = cls.toUpperCase();
                header.style.cursor = 'pointer';
                header.title = 'Clique para recolher/expandir';
                section.appendChild(header);

                const inner = document.createElement('div');
                section.appendChild(inner);
                sectionInners[cls] = inner;

                header.addEventListener('click', () => {
                    inner.hidden = !inner.hidden;
                });

                Object.keys(traitMap[cls])
                    .sort()
                    .forEach((desc) => {
                        const fieldset = document.createElement("fieldset");
                        fieldset.className = "radio-group";

                        const legend = document.createElement("legend");
                        legend.textContent = desc;
                        fieldset.appendChild(legend);

                        const groupName = `${cls}__${desc}`;

                        function makeRadio(value, label, { showCount = true } = {}) {
                            const id = `${groupName}-${value || "all"}`;
                            const wrapper = document.createElement("label");
                            wrapper.setAttribute('for', id);

                            const input = document.createElement("input");
                            input.id = id;
                            input.type = "radio";
                            input.name = groupName;
                            input.value = value;
                            if (value === "") input.checked = true;

                            input.addEventListener("change", (e) => {
                                const val = e.target.value;
                                if (val) {
                                    if (!selectedFilters[cls]) selectedFilters[cls] = {};
                                    selectedFilters[cls][desc] = val;
                                } else {
                                    if (selectedFilters[cls]) {
                                        delete selectedFilters[cls][desc];
                                        if (Object.keys(selectedFilters[cls]).length === 0) {
                                            delete selectedFilters[cls];
                                        }
                                    }
                                }
                                saveStateToHash();
                                render();
                            });

                            const labelText = document.createTextNode(` ${label} `);

                            wrapper.appendChild(input);
                            wrapper.appendChild(labelText);

                            if (showCount) {
                                const countSpan = document.createElement("span");
                                countSpan.className = "count";
                                countSpan.textContent = "";
                                wrapper.appendChild(countSpan);
                                radioInfoList.push({ input, countSpan, cls, desc, value });
                            } else {
                                radioInfoList.push({ input, countSpan: null, cls, desc, value });
                            }

                            fieldset.appendChild(wrapper);
                        }

                        makeRadio("", "Todos", { showCount: false });
                        [...traitMap[cls][desc]].sort().forEach((qual) => {
                            makeRadio(qual, qual);
                        });
                        makeRadio(UNKNOWN_VALUE, UNKNOWN_LABEL);

                        inner.appendChild(fieldset);

                        if (!fieldsetRefs[cls]) fieldsetRefs[cls] = {};
                        fieldsetRefs[cls][desc] = fieldset;
                    });

                container.appendChild(section);
            });

        toc.addEventListener("click", (e) => {
            if (e.target.tagName === "A") {
                e.preventDefault();
                const id = e.target.getAttribute("href").slice(1);
                const target = document.getElementById(id);
                if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
            }
        });
    }

    function getFilteredData() {
        const query = searchInput.value.trim().toLowerCase();
        return data.filter((item) => {
            if (query && !item.name.toLowerCase().includes(query)) return false;
            for (const [cls, descriptors] of Object.entries(selectedFilters)) {
                const itemDescriptors = item.traits[cls];
                for (const [desc, qual] of Object.entries(descriptors)) {
                    if (qual === UNKNOWN_VALUE) {
                        if (itemDescriptors && Object.prototype.hasOwnProperty.call(itemDescriptors, desc)) return false;
                    } else {
                        if (!itemDescriptors || itemDescriptors[desc] !== qual) return false;
                    }
                }
            }
            return true;
        });
    }

    function computeCounts(remaining) {
        const counts = {};
        Object.entries(traitMap).forEach(([cls, descriptors]) => {
            if (!counts[cls]) counts[cls] = {};
            Object.entries(descriptors).forEach(([desc, values]) => {
                if (!counts[cls][desc]) counts[cls][desc] = {};
                counts[cls][desc][UNKNOWN_VALUE] = 0;
                [...values].forEach((v) => { counts[cls][desc][v] = 0; });
                counts[cls][desc][""] = remaining.length;
            });
        });

        remaining.forEach((item) => {
            Object.entries(traitMap).forEach(([cls, descriptors]) => {
                Object.keys(descriptors).forEach((desc) => {
                    const itemDescriptors = item.traits[cls] || {};
                    if (Object.prototype.hasOwnProperty.call(itemDescriptors, desc)) {
                        const val = itemDescriptors[desc];
                        if (counts?.[cls]?.[desc]?.[val] != null) counts[cls][desc][val]++;
                    } else {
                        counts[cls][desc][UNKNOWN_VALUE]++;
                    }
                });
            });
        });
        return counts;
    }

    function updateCountSpans(counts) {
        radioInfoList.forEach(({ countSpan, cls, desc, value }) => {
            if (!countSpan) return;
            const count = counts?.[cls]?.[desc]?.[value] ?? 0;
            countSpan.textContent = `(${count})`;
        });
    }

    function reorderFieldsets(counts) {
        Object.keys(traitMap).forEach((cls) => {
            const inner = sectionInners[cls];
            if (!inner) return;

            const entries = Object.keys(traitMap[cls]).map((desc) => {
                // Is this descriptor actively filtered (NOT "Todos")?
                const isActive = !!(selectedFilters?.[cls] && Object.prototype.hasOwnProperty.call(selectedFilters[cls], desc));

                // Informativeness score (live)
                let score = 0;
                if (filterSortMode === "info") {
                    const buckets = counts?.[cls]?.[desc] || null;
                    if (buckets) {
                        Object.entries(buckets).forEach(([val, cnt]) => {
                            if (val === "") return;   // skip meta "Todos"
                            if (cnt > 0) score++;
                        });
                    } else {
                        score = traitMap[cls][desc].size + 1; // fallback
                    }
                }

                return [desc, fieldsetRefs?.[cls]?.[desc], score, isActive];
            });

            entries.sort((a, b) => {
                // 1) Active filters first (pinned)
                if (a[3] !== b[3]) return b[3] - a[3];

                // 2) Then by chosen sort mode
                if (filterSortMode === "info") {
                    if (b[2] !== a[2]) return b[2] - a[2];       // score desc
                    return a[0].localeCompare(b[0]);             // tie-break A–Z
                }

                // "alpha"
                return a[0].localeCompare(b[0]);
            });

            // Re-append in new order
            entries.forEach(([, fieldset]) => {
                if (fieldset) inner.appendChild(fieldset);
            });
        });
    }

    function renderActiveChips() {
        activeFiltersWrap.innerHTML = '';
        Object.entries(selectedFilters).forEach(([cls, descriptors]) => {
            Object.entries(descriptors).forEach(([desc, value]) => {
                const chip = document.createElement('span');
                chip.className = 'chip';
                chip.innerHTML = `<strong>${cls}</strong>: ${desc} = ${value}`;
                const btn = document.createElement('button');
                btn.setAttribute('aria-label', 'Remover filtro');
                btn.textContent = '×';
                btn.addEventListener('click', () => {
                    delete selectedFilters[cls][desc];
                    if (Object.keys(selectedFilters[cls]).length === 0) delete selectedFilters[cls];
                    const groupName = `${cls}__${desc}`;
                    const allRadio = document.querySelector(`input[name="${CSS.escape(groupName)}"][value=""]`);
                    if (allRadio) allRadio.checked = true;
                    saveStateToHash();
                    render();
                });
                chip.appendChild(btn);
                activeFiltersWrap.appendChild(chip);
            });
        });
    }

    function createCard(item) {
        const card = document.createElement("article");
        card.className = "card";
        card.innerHTML = `
  <img src="${item.image}" alt="Placeholder for ${item.name}" loading="lazy">
  <div class="card-content">
    <h3>${item.name}</h3>
    <div class="tags">
      ${Object.entries(item.traits)
                .map(([cls, descriptors]) =>
                    Object.entries(descriptors)
                        .map(([desc, qual]) => `<span class="tag">${cls}: ${desc} = ${qual}</span>`)
                        .join("")
                )
                .join("")}
    </div>
  </div>`;
        return card;
    }

    function render() {
        const remaining = getFilteredData();
        const counts = computeCounts(remaining);
        updateCountSpans(counts);
        renderActiveChips();
        reorderFieldsets(counts);

        cardsContainer.innerHTML = "";
        if (!remaining.length) {
            emptyEl.hidden = false;
        } else {
            emptyEl.hidden = true;
            remaining.forEach((item) => cardsContainer.appendChild(createCard(item)));
        }
    }

    clearBtn.addEventListener("click", () => {
        document.querySelectorAll('#filters input[type=radio][value=""]').forEach((rb) => { rb.checked = true; });
        selectedFilters = {};
        searchInput.value = '';
        saveStateToHash();
        render();
    });

    collapseAllBtn.addEventListener('click', () => {
        document.querySelectorAll('#filters section > div').forEach(div => { div.hidden = !div.hidden; });
    });

    searchInput.addEventListener('input', () => { saveStateToHash(); render(); });

    sortModeSelect.addEventListener("change", () => {
        filterSortMode = sortModeSelect.value;
        saveStateToHash();
        render();
    });

    loadStateFromHash();
    sortModeSelect.value = filterSortMode;
    buildFilters();

    Object.entries(selectedFilters).forEach(([cls, descs]) => {
        Object.entries(descs).forEach(([desc, value]) => {
            const groupName = `${cls}__${desc}`;
            const radio = document.querySelector(`input[name="${CSS.escape(groupName)}"][value="${CSS.escape(value)}"]`);
            if (radio) radio.checked = true;
        });
    });

    await hydrateImagesFromWikidata(data);
    render();
};

let specs, data;

async function loadDataAndInit() {
    const specsResp = await fetch('specs.json');
    specs = await specsResp.json();

    const dbResp = await fetch('database.json');
    data = await dbResp.json();

    init();
}

loadDataAndInit();
