const FormulaError = require('../formulas/error');
const {FormulaHelpers, Types} = require('../formulas/helpers');
const {Prefix, Postfix, Infix, Operators} = require('../formulas/operators');

class Utils {

    constructor(context) {
        this.context = context;
    }

    columnNameToNumber(columnName) {
        columnName = columnName.toUpperCase();
        const len = columnName.length;
        let number = 0;
        for (let i = 0; i < len; i++) {
            const code = columnName.charCodeAt(i);
            if (!isNaN(code)) {
                number += (code - 64) * 26 ** (len - i - 1)
            }
        }
        return number;
    }

    /**
     * Parse the cell address only.
     * @param {string} cellAddress
     * @return {{ref: {col: number, address: string, row: number}}}
     */
    parseCellAddress(cellAddress) {
        const res = cellAddress.match(/([$]?)([A-Za-z]{1,3})([$]?)([1-9][0-9]*)/);
        // console.log('parseCellAddress', cellAddress);
        return {
            ref: {
                address: res[0],
                col: this.columnNameToNumber(res[2]),
                row: +res[4]
            },
        };
    }

    parseColRange(colRange) {
        const res = colRange.match(/([$]?)([A-Za-z]{1,3}):([$]?)([A-Za-z]{1,4})/);
        return {
            ref: {
                address: res[0],
                from: {
                    address: res[2],
                    col: this.columnNameToNumber(res[2]),
                    row: null
                },
                to: {
                    address: res[4],
                    col: this.columnNameToNumber(res[4]),
                    row: null
                }
            }
        }
    }

    parseRowRange(rowRange) {
        const res = rowRange.match(/([$]?)([1-9][0-9]*):([$]?)([1-9][0-9]*)/);
        return {
            ref: {
                address: res[0],
                from: {
                    address: res[2],
                    col: null,
                    row: +res[2],
                },
                to: {
                    address: res[4],
                    col: null,
                    row: +res[4]
                }
            }

        }
    }

    /**
     * Apply + or - unary prefix.
     * @param {Array.<string>} prefixes
     * @param {*} value
     * @return {*}
     */
    applyPrefix(prefixes, value) {
        // console.log('applyPrefix', prefixes, value);
        const {val, isArray} = this.extractRefValue(value);
        return Prefix.unaryOp(prefixes, val, isArray);
    }

    applyPostfix(value, postfix) {
        // console.log('applyPostfix', value, postfix);
        const {val, isArray} = this.extractRefValue(value);
        return Postfix.percentOp(val, postfix, isArray);
    }

    applyInfix(value1, infix, value2) {
        const res1 = this.extractRefValue(value1);
        const val1 = res1.val, isArray1 = res1.isArray;
        const res2 = this.extractRefValue(value2);
        const val2 = res2.val, isArray2 = res2.isArray;
        if (Operators.compareOp.includes(infix))
            return Infix.compareOp(val1, infix, val2, isArray1, isArray2);
        else if (Operators.concatOp.includes(infix))
            return Infix.concatOp(val1, infix, val2, isArray1, isArray2);
        else if (Operators.mathOp.includes(infix))
            return Infix.mathOp(val1, infix, val2, isArray1, isArray2);
        else
            throw new Error(`Unrecognized infix: ${infix}`);

    }

    applyIntersect(refs) {
        console.log('applyIntersect', refs);
        // a intersection will keep track of references, value won't be retrieved here.
        let maxRow, maxCol, minRow, minCol, sheet, res; // index start from 1
        // first time setup
        const ref = refs.shift().ref;
        sheet = ref.sheet;
        if (!ref.from) {
            // cell ref
            maxRow = minRow = ref.row;
            maxCol = minCol = ref.col;
        }
        else {
            // range ref
            // update
            maxRow = Math.max(ref.from.row, ref.to.row);
            minRow = Math.min(ref.from.row, ref.to.row);
            maxCol = Math.max(ref.from.col, ref.to.col);
            minCol = Math.min(ref.from.col, ref.to.col);
        }

        refs.forEach(ref => {
            ref = ref.ref;
            if (!ref.from) {
                // cell ref
                if (ref.row > maxRow || ref.row < minRow || ref.col > maxCol || ref.col < minCol
                    || sheet !== ref.sheet) {
                    throw FormulaError.NULL;
                }
                maxRow = minRow = ref.row;
                maxCol = minCol = ref.col;
            }
            else {
                // range ref
                const refMaxRow = Math.max(ref.from.row, ref.to.row);
                const refMinRow = Math.min(ref.from.row, ref.to.row);
                const refMaxCol = Math.max(ref.from.col, ref.to.col);
                const refMinCol = Math.min(ref.from.col, ref.to.col);
                if (refMinRow > maxRow || refMaxRow < minRow || refMinCol > maxCol || refMaxCol < minCol
                    || sheet !== ref.sheet) {
                    throw FormulaError.NULL;
                }
                // update
                maxRow = Math.min(maxRow, refMaxRow);
                minRow = Math.max(minRow, refMinRow);
                maxCol = Math.min(maxCol, refMaxCol);
                minCol = Math.max(minCol, refMinCol);
            }
        });
        // check if the ref can be reduced to cell reference
        if (maxRow === minRow && maxCol === minCol) {
            res = {
                ref: {
                    sheet,
                    row: maxRow,
                    col: maxCol
                }
            }
        }
        else {
            res = {
                ref: {
                    sheet,
                    from: {row: minRow, col: minCol},
                    to: {row: maxRow, col: maxCol}
                }
            };
        }

        if (!res.ref.sheet)
            delete res.ref.sheet;
        return res;
    }

    applyUnion(refs) {
        const unions = [];
        // a union won't keep references
        refs.forEach(ref => {
            unions.push(this.extractRefValue(ref).val);
        });

        console.log('applyUnion', unions);
        return {collections: unions};
    }

    /**
     * Apply multiple references, e.g. A1:B3:C8:.....
     * @param refs
     * @return {{ref: {from: {col: number, row: number}, to: {col: number, row: number}}}}
     */
    applyRange(refs) {
        let maxRow = -1, maxCol = -1, minRow = 1048577, minCol = 1048577;
        refs.forEach(ref => {
            ref = ref.ref;
            if (ref.row > maxRow)
                maxRow = ref.row;
            if (ref.row < minRow)
                minRow = ref.row;
            if (ref.col > maxCol)
                maxCol = ref.col;
            if (ref.col < minCol)
                minCol = ref.col;
        });
        return {
            ref: {
                from: {row: minRow, col: minCol},
                to: {row: maxRow, col: maxCol}
            }
        };
    }

    /**
     * Throw away the refs, and retrieve the value.
     */
    extractRefValue(obj) {
        let res = obj, isArray = false;
        if (Array.isArray(res))
            isArray = true;
        if (obj.ref) {
            // can be number or array
            return {val: this.context.retrieveRef(obj), isArray};

        }
        return {val: res, isArray};
    }

    /**
     *
     * @param array
     * @return {Array}
     */
    toArray(array) {
        // TODO: check if array is valid
        // console.log('toArray', array);
        return array;
    }

    /**
     * @param {string} number
     * @return {number}
     */
    toNumber(number) {
        return Number(number);
    }

    /**
     * @param {string} string
     * @return {string}
     */
    toString(string) {
        return string.substring(1, string.length - 1);
    }

    /**
     * @param {string} bool
     * @return {boolean}
     */
    toBoolean(bool) {
        return bool === 'TRUE';
    }

    /**
     * Throw an error.
     * @param {string} error
     * @return {string}
     */
    toError(error) {
        throw new FormulaError(error.toUpperCase());
    }
}

module.exports = Utils;
