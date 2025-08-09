from SPARQLWrapper import SPARQLWrapper, JSON, POST
from collections import defaultdict
from typing import List, Dict, Any
from urllib.parse import quote
import json

ENDPOINT_URL = "https://reflora-traits-test.wikibase.cloud/query/sparql"

QUERY = """
PREFIX wikibase: <http://wikiba.se/ontology#>
PREFIX wd: <https://reflora-traits-test.wikibase.cloud/entity/>
PREFIX wdt: <https://reflora-traits-test.wikibase.cloud/prop/direct/>
PREFIX p: <https://reflora-traits-test.wikibase.cloud/prop/>
PREFIX ps: <https://reflora-traits-test.wikibase.cloud/prop/statement/>
PREFIX pq: <https://reflora-traits-test.wikibase.cloud/prop/qualifier/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX schema: <http://schema.org/>

SELECT ?item ?itemLabel ?prop ?propLabel ?propDirect ?descriptor ?descriptorLabel ?value ?valueLabel ?image ?wikidataID
WHERE {
  wd:Q13 wdt:P6 ?item .

  ?item ?propDirect ?descriptor .
  ?prop wikibase:directClaim ?propDirect .
  ?prop wikibase:claim ?p .
  ?prop wikibase:statementProperty ?ps .

  ?item ?p ?statement .
  ?statement ?ps ?descriptor .
  ?statement pq:P4 ?value .

  OPTIONAL { ?item wdt:P11 ?image }

  OPTIONAL { ?item wdt:P12 ?wikidataID }

  ?item rdfs:label ?itemLabel .
  FILTER(LANG(?itemLabel) = "pt")

  ?descriptor rdfs:label ?descriptorLabel .
  FILTER(LANG(?descriptorLabel) = "pt")

  ?value rdfs:label ?valueLabel .
  FILTER(LANG(?valueLabel) = "pt")

  ?prop rdfs:label ?propLabel .
  FILTER(LANG(?propLabel) = "pt")
}
"""


def _last_fragment(uri: str) -> str:
    return uri.rstrip("/").split("/")[-1]


def run_sparql_query(endpoint_url: str, query: str) -> List[Dict[str, Any]]:
    sparql = SPARQLWrapper(endpoint_url)
    sparql.setQuery(query)
    sparql.setReturnFormat(JSON)
    sparql.setMethod(POST)  # Avoid long URL issues
    results = sparql.query().convert()
    return results["results"]["bindings"]


def format_results(bindings: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    items: Dict[str, Dict[str, Any]] = {}

    for row in bindings:
        item_uri = row["item"]["value"]
        item_qid = _last_fragment(item_uri)
        item_label = row["itemLabel"]["value"]
        prop_label = row["propLabel"]["value"]
        descriptor_label = row["descriptorLabel"]["value"]
        value_label = row["valueLabel"]["value"]

        # Optional image filename literal from SPARQL
        image_url = row.get("image", {}).get("value")
        wikidata_id = row.get("wikidataID", {}).get("value")

        if item_qid not in items:
            items[item_qid] = {
                "name": item_label,
                "wikibase": item_qid,
                "wikidata_xref": wikidata_id,
                "traits": defaultdict(dict),
                # store both raw filename and a ready-to-use Commons URL (if present)
                **({"imageFilename": image_url} if image_url else {}),
            }

        items[item_qid]["traits"][prop_label][descriptor_label] = value_label

        # If later rows have image and the first didn't, fill it once
        if image_url and "imageURL" not in items[item_qid]:
            items[item_qid]["imageURL"] = image_url

    # Convert defaultdicts → dicts
    result = []
    for obj in items.values():
        traits_clean = {cat: dict(descs) for cat, descs in obj["traits"].items()}
        base = {
            "name": obj["name"],
            "wikibase": obj["wikibase"],
            "wikidata_xref": obj["wikidata_xref"],
            "traits": traits_clean,
        }
        if "imageURL" in obj:
            base["imageURL"] = obj["imageURL"]
        result.append(base)

    result.sort(key=lambda x: x["name"].lower())
    return result


if __name__ == "__main__":
    bindings = run_sparql_query(ENDPOINT_URL, QUERY)
    parsed = format_results(bindings)

    with open("database.json", "w", encoding="utf-8") as f:
        json.dump(parsed, f, ensure_ascii=False, indent=2)

    print(f"Saved {len(parsed)} items to database.json")
