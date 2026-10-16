"""Output helper: human text by default, raw JSON with --json. Stdlib only."""

import json


def emit(obj, as_json=False):
    if as_json:
        print(json.dumps(obj, default=str))
        return
    if isinstance(obj, dict):
        for key in obj:
            print("%s: %s" % (key, obj[key]))
    elif isinstance(obj, (list, tuple)):
        for item in obj:
            if isinstance(item, dict):
                print(" | ".join("%s=%s" % (k, item[k]) for k in item))
            else:
                print(item)
    else:
        print(obj)
