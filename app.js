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

    // Cache to avoid duplicate network calls
    const wikidataImageCache = new Map();

    async function getWikidataImageURL(qid, width = 640) {
        if (!qid) return null;
        if (wikidataImageCache.has(qid)) return wikidataImageCache.get(qid);

        // 1) Fetch entity JSON
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

        // 2) Convert filename (with spaces) to a live image via Commons
        const filename = encodeURIComponent(p18); // e.g., "Eucalyptus_globulus_fleurs.jpg"
        const filePath = `https://commons.wikimedia.org/wiki/Special:FilePath/${filename}?width=${width}`;

        wikidataImageCache.set(qid, filePath);
        return filePath;
    }

    // Resolve images for all items in parallel; keep any existing fallback image if no P18
    async function hydrateImagesFromWikidata(items) {
        await Promise.all(items.map(async (it) => {
            const url = await getWikidataImageURL(it.wikidata);
            if (url) it.image = url;
        }));
    }

    // =========================
    // Construir mapa de traços
    // =========================
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

    // Estado dos filtros selecionados
    let selectedFilters = {};

    // Guardamos referências para atualizar contagens rapidamente
    const radioInfoList = [];

    // Persistência simples via URL hash
    function saveStateToHash() {
        const state = { selectedFilters, q: searchInput.value };
        location.hash = encodeURIComponent(JSON.stringify(state));
    }
    function loadStateFromHash() {
        try {
            if (location.hash.length > 1) {
                const state = JSON.parse(decodeURIComponent(location.hash.slice(1)));
                selectedFilters = state.selectedFilters || {};
                const q = state.q || '';
                searchInput.value = q;
            }
        } catch (_) { }
    }

    // =========================
    // Construir UI de filtros
    // =========================
    function buildFilters() {
        const container = document.getElementById("filters");
        const toc = document.getElementById("toc");

        Object.keys(traitMap)
            .sort()
            .forEach((cls) => {
                // âncora de navegação
                const anchorLink = document.createElement("a");
                anchorLink.href = `#sec-${cls}`;
                anchorLink.textContent = cls;
                toc.appendChild(anchorLink);

                // seção dos filtros da classe (colapsável)
                const section = document.createElement("section");
                section.id = `sec-${cls}`;

                const header = document.createElement("h3");
                header.textContent = cls.toUpperCase();
                header.style.cursor = 'pointer';
                header.title = 'Clique para recolher/expandir';
                section.appendChild(header);

                const inner = document.createElement('div');
                section.appendChild(inner);

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

                        const groupName = `${cls}__${desc}`; // único por descritor

                        function makeRadio(value, label, { showCount = true } = {}) {
                            const id = `${groupName}-${value || "all"}`;
                            const wrapper = document.createElement("label");
                            wrapper.setAttribute('for', id);

                            const input = document.createElement("input");
                            input.id = id;
                            input.type = "radio";
                            input.name = groupName;
                            input.value = value;
                            if (value === "") input.checked = true; // "Todos" padrão

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

                            // span de contagem — NÃO mostrar para "Todos"
                            if (showCount) {
                                const countSpan = document.createElement("span");
                                countSpan.className = "count";
                                countSpan.textContent = ""; // será preenchido depois
                                wrapper.appendChild(countSpan);
                                radioInfoList.push({ input, countSpan, cls, desc, value });
                            } else {
                                // mesmo sem count, guardamos para restaurar estado do radio
                                radioInfoList.push({ input, countSpan: null, cls, desc, value });
                            }

                            fieldset.appendChild(wrapper);
                        }

                        // "Todos" — sem número ao lado (REQUISITO 1)
                        makeRadio("", "Todos", { showCount: false });

                        // valores conhecidos
                        [...traitMap[cls][desc]].sort().forEach((qual) => {
                            makeRadio(qual, qual);
                        });

                        // desconhecido
                        makeRadio(UNKNOWN_VALUE, UNKNOWN_LABEL);

                        inner.appendChild(fieldset);
                    });

                container.appendChild(section);
            });

        /* Navegação suave dentro do painel */
        toc.addEventListener("click", (e) => {
            if (e.target.tagName === "A") {
                e.preventDefault();
                const id = e.target.getAttribute("href").slice(1);
                const target = document.getElementById(id);
                if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
            }
        });
    }

    // ============= Lógica de filtragem e contagem =============
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
                counts[cls][desc][""] = remaining.length; // mantém referência (não exibimos em UI)
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
            if (!countSpan) return; // não mostrar para "Todos"
            const count = counts?.[cls]?.[desc]?.[value] ?? 0;
            countSpan.textContent = `(${count})`;
        });
    }

    // Filtros ativos (chips)
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
                    // Marcar o radio "Todos" correspondente
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

    // ============= Cartões =============
    function createCard(item) {
        const card = document.createElement("article");
        card.className = "card";
        card.innerHTML = `
  <img src="${item.image}" alt="${item.name}" loading="lazy">
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

        // renderizar cartões
        cardsContainer.innerHTML = "";
        if (!remaining.length) {
            emptyEl.hidden = false;
        } else {
            emptyEl.hidden = true;
            remaining.forEach((item) => cardsContainer.appendChild(createCard(item)));
        }
    }

    // Eventos
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

    // Inicializar
    loadStateFromHash();
    buildFilters();

    // Restaurar estado dos radios a partir do hash
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

    init(); // your existing init code
}

loadDataAndInit();