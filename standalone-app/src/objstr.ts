export default function(obj: {[key: string]: boolean}): string {
    let k,
        cls = "";
    for (k in obj) {
        if (obj[k]) {
            if (cls) cls += " ";
            cls += k;
        }
    }
    return cls;
}
