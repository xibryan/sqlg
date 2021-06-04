(function ($) {
    $.extend(true, window, {
        Slick: {
            Data: {
                DataTreeView: DataTreeView
            }
        }
    });


    /***
     * A sample Model implementation.
     * Provides a filtered view of the underlying data.
     *
     * Relies on the data item having an "id" property uniquely identifying it.
     */
    function DataTreeView(options) {
        var self = this;

        var defaults = {
            groupItemMetadataProvider: null,
            inlineFilters: false
        };


        // private
        var idProperty = "id";  // property holding a unique row id
        var newItems = [];      // new data by index
        var deletedItems = [];  // deleted data by index
        var updatedItems = [];  // updated data by index
        var items = [];         // data by index
        var rows = [];          // data by row
        var idxById = {};       // indexes by id
        var updatedIdxById = {};// updated indexes by id
        var newIdxById = {};    // new indexes by id

        var rowsById = null;    // rows by id; lazy-calculated
        var filter = null;      // filter function
        var updated = null;     // updated item ids
        var suspend = false;    // suspends the recalculation
        var sortAsc = true;
        var fastSortField;
        var sortComparer;
        var refreshHints = {};
        var prevRefreshHints = {};
        var filterArgs = {fromTree: false};
        var filteredItems = [];
        var compiledFilter;
        var compiledFilterWithCaching;
        var filterCache = [];

        // grouping
        var groupingInfoDefaults = {
            getter: null,
            formatter: null,
            comparer: function (a, b) {
                return (a.value === b.value ? 0 :
                        (a.value > b.value ? 1 : -1)
                );
            },
            predefinedValues: [],
            aggregators: [],
            aggregateEmpty: false,
            aggregateCollapsed: false,
            aggregateChildGroups: false,
            collapsed: false,
            displayTotalsRow: true,
            lazyTotalsCalculation: false
        };
        var groupingInfos = [];
        var groups = [];
        var toggledGroupsByLevel = [];
        var groupingDelimiter = ':|:';

        var pagesize = 0;
        var pagenum = 0;
        var totalRows = 0;

        // events
        var onRowCountChanged = new Slick.Event();
        var onRowsChanged = new Slick.Event();
        var onPagingInfoChanged = new Slick.Event();

        options = $.extend(true, {}, defaults, options);

        function beginUpdate() {
            suspend = true;
        }

        function endUpdate() {
            suspend = false;
            refresh();
        }

        function setRefreshHints(hints) {
            refreshHints = hints;
        }

        function mergeAndSelect(elementStack, fetchChildren, completeCallback) {
            internalMergeAndSelect(elementStack, undefined, fetchChildren, completeCallback);
        }

        function internalMergeAndSelect(elementStack, previous, fetchChildren, completeCallback) {
            let doSelectItem = true;
            for (let i = 0; i < elementStack.length; i++) {
                let element = elementStack[i];
                let item = getItemById(element);
                if (!item) {
                    doSelectItem = false;
                    elementStack.splice(0, i + 1);
                    fetchChildren(previous, function (children) {
                        addChildren(previous, children);
                        previous = getItemById(element);
                        if (previous) {
                            internalMergeAndSelect(elementStack, previous, fetchChildren, completeCallback);
                        }
                    });
                    break;
                }
                previous = item;
            }
            if (doSelectItem) {
                selectItem(previous);
                completeCallback(previous);
            }
        }

        function selectItem(item) {
            beginUpdate();
            internalSelectItem(item);
            item._collapsed = true;
            endUpdate();
        }

        function internalSelectItem(item) {
            item._collapsed = false;
            setFilterArgs({item: item, fromTree: true, isTreeCollapsing: item._collapsed});
            updateItem(item.id, item);
            if (item.parent) {
                internalSelectItem(getItemById(item.parent));
            }
        }

        function addChildren(item, children) {
            beginUpdate();
            //reindex everything below the current item
            let start = false;
            let index = 0;
            for (let i = 0; i < items.length; i++) {
                let currentItem = items[i];
                if (!start && item.id === currentItem.id) {
                    start = true;
                    index = i;
                    for (let j = 0; j < children.length; j++) {
                        let child = children[j];
                        child.parent = currentItem.id;
                        child.index = i + j + 1;
                        child.indent = currentItem.indent + 1;
                        // item.children.push(childIndex);
                        item.children.push(child.id);
                    }
                    currentItem._fetched = true;
                } else if (start) {
                    currentItem.index = currentItem.index + children.length;
                }
            }
            if (children.length === 0) {
                item.isLeaf = true;
            }
            let tmp1 = items.slice(0, index + 1);
            let tmp2 = items.slice(index + 1);
            items = tmp1.concat(children).concat(tmp2);
            // items.splice(index + 1, 0, ...children);
            updateIdxById(index);
            endUpdate();
        }

        function setFilterArgs(args) {
            filterArgs = args;
        }

        function updateIdxById(startingIndex) {
            startingIndex = startingIndex || 0;
            var id;
            for (var i = startingIndex, l = items.length; i < l; i++) {
                id = items[i][idProperty];
                if (id === undefined) {
                    throw "Each data element must implement a unique 'id' property";
                }
                idxById[id] = i;
            }
        }

        function updateNewIdxById(startingIndex) {
            startingIndex = startingIndex || 0;
            var id;
            for (var i = startingIndex, l = newItems.length; i < l; i++) {
                var newItem = newItems[i];
                id = newItem[idProperty];
                if (id === undefined) {
                    throw "Each data element must implement a unique 'id' property";
                }
                newItem['_index'] = i;
                newIdxById[id] = i;
            }
        }

        function updateUpdatedIdxById(startingIndex) {
            startingIndex = startingIndex || 0;
            var id;
            for (var i = startingIndex, l = updatedItems.length; i < l; i++) {
                var updatedItem = updatedItems[i]
                id = updatedItem[idProperty];
                if (id === undefined) {
                    throw "Each data element must implement a unique 'id' property";
                }
                updatedItem['_index'] = i;
                updatedIdxById[id] = i;
            }
        }

        function ensureIdUniqueness() {
            var id;
            for (var i = 0, l = items.length; i < l; i++) {
                id = items[i][idProperty];
                if (id === undefined || idxById[id] !== i) {
                    throw new Error("Each data element must implement a unique 'id' property");
                }
            }
        }

        function getItems() {
            return items;
        }

        function getNewItems() {
            return newItems;
        }

        function getDeletedItems() {
            return deletedItems;
        }

        function getUpdatedItems() {
            return updatedItems;
        }

        function resetItems() {
            for (var i = 0; i < newItems.length; i++) {
                //do not call deleteItems as that puts items in the deletedItem cache
                var id = newItems[i].id;
                var idx = idxById[id];
                if (idx === undefined) {
                    throw "Invalid id";
                }
                delete idxById[id];
                items.splice(idx, 1);
                updateIdxById(idx);
                refresh();

            }
            for (var i = 0; i < deletedItems.length; i++) {
                //do not call addItem as that puts items in the newItem array
                var item = deletedItems[i];
                items.push(item);
                updateIdxById(items.length - 1);
                refresh();
            }
            newItems = [];
            deletedItems = [];
        }

        function afterSave() {
            newItems = [];
            deletedItems = [];
        }

        function setItems(data, objectIdProperty) {
            if (objectIdProperty !== undefined) {
                idProperty = objectIdProperty;
            }
            items = filteredItems = data;
            idxById = {};
            updateIdxById();
            ensureIdUniqueness();
            refresh();
        }

        function setPagingOptions(args) {
            if (args.pageSize != undefined) {
                pagesize = args.pageSize;
                pagenum = pagesize ? Math.min(pagenum, Math.max(0, Math.ceil(totalRows / pagesize) - 1)) : 0;
            }

            if (args.pageNum != undefined) {
                pagenum = Math.min(args.pageNum, Math.max(0, Math.ceil(totalRows / pagesize) - 1));
            }

            onPagingInfoChanged.notify(getPagingInfo(), null, self);

            refresh();
        }

        function getPagingInfo() {
            var totalPages = pagesize ? Math.max(1, Math.ceil(totalRows / pagesize)) : 1;
            return {pageSize: pagesize, pageNum: pagenum, totalRows: totalRows, totalPages: totalPages};
        }

        function sort(comparer, ascending) {
            sortAsc = ascending;
            sortComparer = comparer;
            fastSortField = null;
            if (ascending === false) {
                items.reverse();
            }
            items.sort(comparer);
            if (ascending === false) {
                items.reverse();
            }
            idxById = {};
            updateIdxById();
            refresh();
        }

        /***
         * Provides a workaround for the extremely slow sorting in IE.
         * Does a [lexicographic] sort on a give column by temporarily overriding Object.prototype.toString
         * to return the value of that field and then doing a native Array.sort().
         */
        function fastSort(field, ascending) {
            sortAsc = ascending;
            fastSortField = field;
            sortComparer = null;
            var oldToString = Object.prototype.toString;
            Object.prototype.toString = (typeof field == "function") ? field : function () {
                return this[field]
            };
            // an extra reversal for descending sort keeps the sort stable
            // (assuming a stable native sort implementation, which isn't true in some cases)
            if (ascending === false) {
                items.reverse();
            }
            items.sort();
            Object.prototype.toString = oldToString;
            if (ascending === false) {
                items.reverse();
            }
            idxById = {};
            updateIdxById();
            refresh();
        }

        function reSort() {
            if (sortComparer) {
                sort(sortComparer, sortAsc);
            } else if (fastSortField) {
                fastSort(fastSortField, sortAsc);
            }
        }

        function getFilteredItems() {
            return filteredItems;
        }


        function getFilter() {
            return filter;
        }

        function setFilter(filterFn) {
            filter = filterFn;
            if (options.inlineFilters) {
                compiledFilter = compileFilter();
                compiledFilterWithCaching = compileFilterWithCaching();
            }
            refresh();
        }

        function getGrouping() {
            return groupingInfos;
        }

        function setGrouping(groupingInfo) {
            if (!options.groupItemMetadataProvider) {
                options.groupItemMetadataProvider = new Slick.Data.GroupItemMetadataProvider();
            }

            groups = [];
            toggledGroupsByLevel = [];
            groupingInfo = groupingInfo || [];
            groupingInfos = (groupingInfo instanceof Array) ? groupingInfo : [groupingInfo];

            for (var i = 0; i < groupingInfos.length; i++) {
                var gi = groupingInfos[i] = $.extend(true, {}, groupingInfoDefaults, groupingInfos[i]);
                gi.getterIsAFn = typeof gi.getter === "function";

                // pre-compile accumulator loops
                gi.compiledAccumulators = [];
                var idx = gi.aggregators.length;
                while (idx--) {
                    gi.compiledAccumulators[idx] = compileAccumulatorLoop(gi.aggregators[idx]);
                }

                toggledGroupsByLevel[i] = {};
            }

            refresh();
        }

        /**
         * @deprecated Please use {@link setGrouping}.
         */
        function groupBy(valueGetter, valueFormatter, sortComparer) {
            if (valueGetter == null) {
                setGrouping([]);
                return;
            }

            setGrouping({
                getter: valueGetter,
                formatter: valueFormatter,
                comparer: sortComparer
            });
        }

        /**
         * @deprecated Please use {@link setGrouping}.
         */
        function setAggregators(groupAggregators, includeCollapsed) {
            if (!groupingInfos.length) {
                throw new Error("At least one grouping must be specified before calling setAggregators().");
            }

            groupingInfos[0].aggregators = groupAggregators;
            groupingInfos[0].aggregateCollapsed = includeCollapsed;

            setGrouping(groupingInfos);
        }

        function getItemByIdx(i) {
            return items[i];
        }

        function getIdxById(id) {
            return idxById[id];
        }

        function ensureRowsByIdCache() {
            if (!rowsById) {
                rowsById = {};
                for (var i = 0, l = rows.length; i < l; i++) {
                    rowsById[rows[i][idProperty]] = i;
                }
            }
        }

        function getRowByItem(item) {
            ensureRowsByIdCache();
            return rowsById[item[idProperty]];
        }

        function getRowById(id) {
            ensureRowsByIdCache();
            return rowsById[id];
        }

        function getItemById(id) {
            return items[idxById[id]];
        }

        function mapItemsToRows(itemArray) {
            var rows = [];
            ensureRowsByIdCache();
            for (var i = 0, l = itemArray.length; i < l; i++) {
                var row = rowsById[itemArray[i][idProperty]];
                if (row != null) {
                    rows[rows.length] = row;
                }
            }
            return rows;
        }

        function mapIdsToRows(idArray) {
            var rows = [];
            ensureRowsByIdCache();
            for (var i = 0, l = idArray.length; i < l; i++) {
                var row = rowsById[idArray[i]];
                if (row != null) {
                    rows[rows.length] = row;
                }
            }
            return rows;
        }

        function mapRowsToIds(rowArray) {
            var ids = [];
            for (var i = 0, l = rowArray.length; i < l; i++) {
                if (rowArray[i] < rows.length) {
                    ids[ids.length] = rows[rowArray[i]][idProperty];
                }
            }
            return ids;
        }

        function updateItem(id, item, columnField) {
            if (idxById[id] === undefined || id !== item[idProperty]) {
                throw "Invalid or non-matching id";
            }
            items[idxById[id]] = item;
            if (!updated) {
                updated = {};
            }
            updated[id] = true;
            refresh();

            //cm cache of updates
            if (newIdxById[id] !== undefined) {
                //updates of new items
                if (newItems[newIdxById[id]].id !== id) {
                    throw "Non matching new id";
                }

                var newField = {};
                newField[columnField] = item[columnField];
                newItems[newIdxById[id]] = $.extend(newItems[newIdxById[id]], newField);
            } else {
                //updates of existing items
                if (updatedIdxById[id] === undefined) {
                    updatedIdxById[id] = updatedItems.length;
                    updatedItems[updatedItems.length] = {id: id};
                } else {
                    if (updatedItems[updatedIdxById[id]].id !== id) {
                        throw "Non matching updated id";
                    }
                }
                var updatedField = {};
                updatedField[columnField] = item[columnField];
                updatedItems[updatedIdxById[id]] = $.extend(updatedItems[updatedIdxById[id]], updatedField);
            }
        }

        function insertItem(insertBefore, item) {
            newItems.push(item);
            items.splice(insertBefore, 0, item);
            updateIdxById(insertBefore);
            refresh();
        }

        function addItem(item) {
            newItems.push(item);
            items.push(item);
            newIdxById[item[idProperty]] = newItems.length - 1;
            updateIdxById(items.length - 1);
            refresh();
        }

        function deleteItem(id) {
            var idx = idxById[id];
            if (idx === undefined) {
                throw new Error("Invalid id");
            }

            //umlg
            if (newIdxById[id] === undefined || newIdxById[id] === null) {
                var item = items[idx];
                deletedItems.push(item);
                //if item in updated array then remove it
                if (updatedIdxById[id] !== undefined || updatedIdxById[id] !== null) {
                    var updatedIdx = updatedIdxById[id];
                    delete updatedIdxById[id];
                    updatedItems.splice(updatedIdx, 1);
                    updateUpdatedIdxById(updatedIdx);
                }
            } else {
                var newIdx = newIdxById[id];
                delete newIdxById[id];
                newItems.splice(newIdx, 1);
                updateNewIdxById(newIdx);
            }
            //umlg

            delete idxById[id];
            items.splice(idx, 1);
            updateIdxById(idx);
            refresh();
        }

        function sortedAddItem(item) {
            if (!sortComparer) {
                throw new Error("sortedAddItem() requires a sort comparer, use sort()");
            }
            insertItem(sortedIndex(item), item);
        }

        function sortedUpdateItem(id, item) {
            if (idxById[id] === undefined || id !== item[idProperty]) {
                throw new Error("Invalid or non-matching id " + idxById[id]);
            }
            if (!sortComparer) {
                throw new Error("sortedUpdateItem() requires a sort comparer, use sort()");
            }
            var oldItem = getItemById(id);
            if (sortComparer(oldItem, item) !== 0) {
                // item affects sorting -> must use sorted add
                deleteItem(id);
                sortedAddItem(item);
            } else { // update does not affect sorting -> regular update works fine
                updateItem(id, item);
            }
        }

        function sortedIndex(searchItem) {
            var low = 0, high = items.length;

            while (low < high) {
                var mid = low + high >>> 1;
                if (sortComparer(items[mid], searchItem) === -1) {
                    low = mid + 1;
                } else {
                    high = mid;
                }
            }
            return low;
        }

        function getLength() {
            return rows.length;
        }

        function getItem(i) {
            var item = rows[i];

            // if this is a group row, make sure totals are calculated and update the title
            if (item && item.__group && item.totals && !item.totals.initialized) {
                var gi = groupingInfos[item.level];
                if (!gi.displayTotalsRow) {
                    calculateTotals(item.totals);
                    item.title = gi.formatter ? gi.formatter(item) : item.value;
                }
            }
            // if this is a totals row, make sure it's calculated
            else if (item && item.__groupTotals && !item.initialized) {
                calculateTotals(item);
            }

            return item;
        }

        function getItemMetadata(i) {
            var item = rows[i];
            if (item === undefined) {
                return null;
            }

            // overrides for grouping rows
            if (item.__group) {
                return options.groupItemMetadataProvider.getGroupRowMetadata(item);
            }

            // overrides for totals rows
            if (item.__groupTotals) {
                return options.groupItemMetadataProvider.getTotalsRowMetadata(item);
            }

            return null;
        }

        function expandCollapseAllGroups(level, collapse) {
            if (level == null) {
                for (var i = 0; i < groupingInfos.length; i++) {
                    toggledGroupsByLevel[i] = {};
                    groupingInfos[i].collapsed = collapse;
                }
            } else {
                toggledGroupsByLevel[level] = {};
                groupingInfos[level].collapsed = collapse;
            }
            refresh();
        }

        /**
         * @param level {Number} Optional level to collapse.  If not specified, applies to all levels.
         */
        function collapseAllGroups(level) {
            expandCollapseAllGroups(level, true);
        }

        /**
         * @param level {Number} Optional level to expand.  If not specified, applies to all levels.
         */
        function expandAllGroups(level) {
            expandCollapseAllGroups(level, false);
        }

        function expandCollapseGroup(level, groupingKey, collapse) {
            toggledGroupsByLevel[level][groupingKey] = groupingInfos[level].collapsed ^ collapse;
            refresh();
        }

        /**
         * @param varArgs Either a Slick.Group's "groupingKey" property, or a
         *     variable argument list of grouping values denoting a unique path to the row.  For
         *     example, calling collapseGroup('high', '10%') will collapse the '10%' subgroup of
         *     the 'high' group.
         */
        function collapseGroup(varArgs) {
            var args = Array.prototype.slice.call(arguments);
            var arg0 = args[0];
            if (args.length == 1 && arg0.indexOf(groupingDelimiter) != -1) {
                expandCollapseGroup(arg0.split(groupingDelimiter).length - 1, arg0, true);
            } else {
                expandCollapseGroup(args.length - 1, args.join(groupingDelimiter), true);
            }
        }

        /**
         * @param varArgs Either a Slick.Group's "groupingKey" property, or a
         *     variable argument list of grouping values denoting a unique path to the row.  For
         *     example, calling expandGroup('high', '10%') will expand the '10%' subgroup of
         *     the 'high' group.
         */
        function expandGroup(varArgs) {
            var args = Array.prototype.slice.call(arguments);
            var arg0 = args[0];
            if (args.length == 1 && arg0.indexOf(groupingDelimiter) != -1) {
                expandCollapseGroup(arg0.split(groupingDelimiter).length - 1, arg0, false);
            } else {
                expandCollapseGroup(args.length - 1, args.join(groupingDelimiter), false);
            }
        }

        function getGroups() {
            return groups;
        }

        function extractGroups(rows, parentGroup) {
            var group;
            var val;
            var groups = [];
            var groupsByVal = {};
            var r;
            var level = parentGroup ? parentGroup.level + 1 : 0;
            var gi = groupingInfos[level];

            for (var i = 0, l = gi.predefinedValues.length; i < l; i++) {
                val = gi.predefinedValues[i];
                group = groupsByVal[val];
                if (!group) {
                    group = new Slick.Group();
                    group.value = val;
                    group.level = level;
                    group.groupingKey = (parentGroup ? parentGroup.groupingKey + groupingDelimiter : '') + val;
                    groups[groups.length] = group;
                    groupsByVal[val] = group;
                }
            }

            for (var i = 0, l = rows.length; i < l; i++) {
                r = rows[i];
                val = gi.getterIsAFn ? gi.getter(r) : r[gi.getter];
                group = groupsByVal[val];
                if (!group) {
                    group = new Slick.Group();
                    group.value = val;
                    group.level = level;
                    group.groupingKey = (parentGroup ? parentGroup.groupingKey + groupingDelimiter : '') + val;
                    groups[groups.length] = group;
                    groupsByVal[val] = group;
                }
                group.rows[group.count++] = r;
            }

            if (level < groupingInfos.length - 1) {
                for (var i = 0; i < groups.length; i++) {
                    group = groups[i];
                    group.groups = extractGroups(group.rows, group);
                }
            }

            groups.sort(groupingInfos[level].comparer);

            return groups;
        }

        function calculateTotals(totals) {
            var group = totals.group;
            var gi = groupingInfos[group.level];
            var isLeafLevel = (group.level == groupingInfos.length);
            var agg, idx = gi.aggregators.length;

            if (!isLeafLevel && gi.aggregateChildGroups) {
                // make sure all the subgroups are calculated
                var i = group.groups.length;
                while (i--) {
                    if (!group.groups[i].totals.initialized) {
                        calculateTotals(group.groups[i].totals);
                    }
                }
            }

            while (idx--) {
                agg = gi.aggregators[idx];
                agg.init();
                if (!isLeafLevel && gi.aggregateChildGroups) {
                    gi.compiledAccumulators[idx].call(agg, group.groups);
                } else {
                    gi.compiledAccumulators[idx].call(agg, group.rows);
                }
                agg.storeResult(totals);
            }
            totals.initialized = true;
        }

        function addGroupTotals(group) {
            var gi = groupingInfos[group.level];
            var totals = new Slick.GroupTotals();
            totals.group = group;
            group.totals = totals;
            if (!gi.lazyTotalsCalculation) {
                calculateTotals(totals);
            }
        }

        function addTotals(groups, level) {
            level = level || 0;
            var gi = groupingInfos[level];
            var groupCollapsed = gi.collapsed;
            var toggledGroups = toggledGroupsByLevel[level];
            var idx = groups.length, g;
            while (idx--) {
                g = groups[idx];

                if (g.collapsed && !gi.aggregateCollapsed) {
                    continue;
                }

                // Do a depth-first aggregation so that parent group aggregators can access subgroup totals.
                if (g.groups) {
                    addTotals(g.groups, level + 1);
                }

                if (gi.aggregators.length && (
                    gi.aggregateEmpty || g.rows.length || (g.groups && g.groups.length))) {
                    addGroupTotals(g);
                }

                g.collapsed = groupCollapsed ^ toggledGroups[g.groupingKey];
                g.title = gi.formatter ? gi.formatter(g) : g.value;
            }
        }

        function flattenGroupedRows(groups, level) {
            level = level || 0;
            var gi = groupingInfos[level];
            var groupedRows = [], rows, gl = 0, g;
            for (var i = 0, l = groups.length; i < l; i++) {
                g = groups[i];
                groupedRows[gl++] = g;

                if (!g.collapsed) {
                    rows = g.groups ? flattenGroupedRows(g.groups, level + 1) : g.rows;
                    for (var j = 0, jj = rows.length; j < jj; j++) {
                        groupedRows[gl++] = rows[j];
                    }
                }

                if (g.totals && gi.displayTotalsRow && (!g.collapsed || gi.aggregateCollapsed)) {
                    groupedRows[gl++] = g.totals;
                }
            }
            return groupedRows;
        }

        function getFunctionInfo(fn) {
            var fnRegex = /^function[^(]*\(([^)]*)\)\s*{([\s\S]*)}$/;
            var matches = fn.toString().match(fnRegex);
            return {
                params: matches[1].split(","),
                body: matches[2]
            };
        }

        function compileAccumulatorLoop(aggregator) {
            var accumulatorInfo = getFunctionInfo(aggregator.accumulate);
            var fn = new Function(
                "_items",
                "for (var " + accumulatorInfo.params[0] + ", _i=0, _il=_items.length; _i<_il; _i++) {" +
                accumulatorInfo.params[0] + " = _items[_i]; " +
                accumulatorInfo.body +
                "}"
            );
            fn.displayName = fn.name = "compiledAccumulatorLoop";
            return fn;
        }

        function compileFilter() {
            var filterInfo = getFunctionInfo(filter);

            var filterPath1 = "{ continue _coreloop; }$1";
            var filterPath2 = "{ _retval[_idx++] = $item$; continue _coreloop; }$1";
            // make some allowances for minification - there's only so far we can go with RegEx
            var filterBody = filterInfo.body
                .replace(/return false\s*([;}]|\}|$)/gi, filterPath1)
                .replace(/return!1([;}]|\}|$)/gi, filterPath1)
                .replace(/return true\s*([;}]|\}|$)/gi, filterPath2)
                .replace(/return!0([;}]|\}|$)/gi, filterPath2)
                .replace(/return ([^;}]+?)\s*([;}]|$)/gi,
                    "{ if ($1) { _retval[_idx++] = $item$; }; continue _coreloop; }$2");

            // This preserves the function template code after JS compression,
            // so that replace() commands still work as expected.
            var tpl = [
                //"function(_items, _args) { ",
                "var _retval = [], _idx = 0; ",
                "var $item$, $args$ = _args; ",
                "_coreloop: ",
                "for (var _i = 0, _il = _items.length; _i < _il; _i++) { ",
                "$item$ = _items[_i]; ",
                "$filter$; ",
                "} ",
                "return _retval; "
                //"}"
            ].join("");
            tpl = tpl.replace(/\$filter\$/gi, filterBody);
            tpl = tpl.replace(/\$item\$/gi, filterInfo.params[0]);
            tpl = tpl.replace(/\$args\$/gi, filterInfo.params[1]);

            var fn = new Function("_items,_args", tpl);
            fn.displayName = fn.name = "compiledFilter";
            return fn;
        }

        function compileFilterWithCaching() {
            var filterInfo = getFunctionInfo(filter);

            var filterPath1 = "{ continue _coreloop; }$1";
            var filterPath2 = "{ _cache[_i] = true;_retval[_idx++] = $item$; continue _coreloop; }$1";
            // make some allowances for minification - there's only so far we can go with RegEx
            var filterBody = filterInfo.body
                .replace(/return false\s*([;}]|\}|$)/gi, filterPath1)
                .replace(/return!1([;}]|\}|$)/gi, filterPath1)
                .replace(/return true\s*([;}]|\}|$)/gi, filterPath2)
                .replace(/return!0([;}]|\}|$)/gi, filterPath2)
                .replace(/return ([^;}]+?)\s*([;}]|$)/gi,
                    "{ if ((_cache[_i] = $1)) { _retval[_idx++] = $item$; }; continue _coreloop; }$2");

            // This preserves the function template code after JS compression,
            // so that replace() commands still work as expected.
            var tpl = [
                //"function(_items, _args, _cache) { ",
                "var _retval = [], _idx = 0; ",
                "var $item$, $args$ = _args; ",
                "_coreloop: ",
                "for (var _i = 0, _il = _items.length; _i < _il; _i++) { ",
                "$item$ = _items[_i]; ",
                "if (_cache[_i]) { ",
                "_retval[_idx++] = $item$; ",
                "continue _coreloop; ",
                "} ",
                "$filter$; ",
                "} ",
                "return _retval; "
                //"}"
            ].join("");
            tpl = tpl.replace(/\$filter\$/gi, filterBody);
            tpl = tpl.replace(/\$item\$/gi, filterInfo.params[0]);
            tpl = tpl.replace(/\$args\$/gi, filterInfo.params[1]);

            var fn = new Function("_items,_args,_cache", tpl);
            fn.displayName = fn.name = "compiledFilterWithCaching";
            return fn;
        }

        function uncompiledFilter(items, args) {
            var retval = [], idx = 0;

            for (var i = 0, ii = items.length; i < ii; i++) {
                if (filter(items[i], args)) {
                    retval[idx++] = items[i];
                    filterCache[i] = true;
                } else {
                    filterCache[i] = false;
                }
            }

            return retval;
        }

        function uncompiledFilterWithCaching(items, args, cache) {
            var retval = [], idx = 0, item;

            for (var i = 0, ii = items.length; i < ii; i++) {
                item = items[i];
                if (cache[i]) {
                    retval[idx++] = item;
                } else if (filter(item, args)) {
                    retval[idx++] = item;
                    cache[i] = true;
                }
            }

            return retval;
        }

        function getChildren(item) {
            let children = [];
            for (let i = 0, ii = item.children.length; i < ii; i++) {
                let childIndex = item.children[i];
                let child = getItemById(childIndex);
                // let child = items[childIndex];
                children.push(child);
            }
            return children;
        }

        function selectChildren(item, callBack) {
            let children = getChildren(item);
            let selectAll;
            for (let i = 0, ii = children.length; i < ii; i++) {
                let child = children[i];
                if (selectAll === undefined) {
                    selectAll = !child.selected;
                }
                let callCallBack = selectAll !== child.selected;
                child.selected = selectAll;
                if (callCallBack) {
                    callBack(child);
                }
                updateItem(child.id, child);
            }
        }

        function collapseAll() {
            for (let i = 0, ii = items.length; i < ii; i++) {
                let item = items[i];
                item._collapsed = true;
                updateItem(item.id, item);
            }
        }

        function deselectAll(callBack) {
            for (let i = 0, ii = items.length; i < ii; i++) {
                let item = items[i];
                if (item['partakesInSelectionFilter'] === undefined || item['partakesInSelectionFilter']) {
                    if (item.selected) {
                        callBack(item);
                    }
                    item.selected = false;
                    updateItem(item.id, item);
                }
            }
        }

        function getFilteredAndPagedItems(items) {

            if (!updated) {
                updated = {};
            }
            let tempFilteredItems = [];
            let batchFilter = options.inlineFilters ? compiledFilter : uncompiledFilter;
            let batchFilterWithCaching = options.inlineFilters ? compiledFilterWithCaching : uncompiledFilterWithCaching;

            if (!filterArgs.fromTree) {
                if (refreshHints.isFilterNarrowing) {
                    tempFilteredItems = batchFilter(filteredItems, filterArgs);
                    filteredItems = uncollapseParents(items, tempFilteredItems);
                } else if (refreshHints.isFilterExpanding) {
                    tempFilteredItems = batchFilterWithCaching(items, filterArgs, filterCache);
                    filteredItems = uncollapseParents(items, tempFilteredItems);
                } else if (refreshHints.collapseAll) {
                    filteredItems = removeItemsWithCollapsedParent(filteredItems)
                } else if (filterArgs.showSelectedOnly) {
                    let tempFilteredItems2 = [];
                    for (let i = 0, ii = items.length; i < ii; i++) {
                        let tempFilteredItem = items[i];
                        if ((tempFilteredItem['partakesInSelectionFilter'] === undefined && tempFilteredItem.selected) || (tempFilteredItem['partakesInSelectionFilter'] && tempFilteredItem.selected)) {
                            tempFilteredItems2.push(tempFilteredItem);
                        }
                    }
                    filteredItems = uncollapseParents(items, tempFilteredItems2);
                } else if (filterArgs.showAll) {
                    tempFilteredItems = batchFilterWithCaching(items, filterArgs, filterCache);
                    filteredItems = uncollapseParents(items, tempFilteredItems);
                } else if (!refreshHints.isFilterUnchanged) {
                    tempFilteredItems = batchFilter(items, filterArgs);
                    if (tempFilteredItems.length === items.length) {
                        filteredItems = removeItemsWithCollapsedParent(items)
                    } else {
                        filteredItems = uncollapseParents(items, tempFilteredItems);
                    }
                } else {
                    tempFilteredItems = batchFilter(items, filterArgs);
                    filteredItems = removeItemsWithCollapsedParent(tempFilteredItems)
                }
            } else {
                let clickedItem = filterArgs.item;
                if (filterArgs.isTreeCollapsing) {
                    //collapsing
                    let tempFilteredItems = [];
                    for (let i = 0, ii = filteredItems.length; i < ii; i++) {
                        let filteredItem = filteredItems[i];

                        let isChild = false;
                        // let parent = getItemByIdx(filteredItem.parent);
                        let parent = getItemById(filteredItem.parent);
                        while (parent) {
                            if (clickedItem.id === parent.id) {
                                isChild = true;
                                break;
                            }
                            // parent = getItemByIdx(parent.parent);
                            parent = getItemById(parent.parent);
                        }

                        if (!isChild) {
                            updated[filteredItem.id] = true;
                            tempFilteredItems.push(filteredItem);
                        }
                    }
                    filteredItems = tempFilteredItems;
                } else {
                    tempFilteredItems = batchFilterWithCaching(items, filterArgs, filterCache);
                    let tempFilteredItemIndex = {};
                    for (let i = 0, ii = tempFilteredItems.length; i < ii; i++) {
                        let tempFilteredItem = tempFilteredItems[i];
                        tempFilteredItemIndex[tempFilteredItem.id] = tempFilteredItem;
                    }

                    let toAddItemIndex = {};
                    let children = getChildren(clickedItem);
                    toAddItemIndex[clickedItem.id] = clickedItem;
                    addChildrenRecursively(tempFilteredItemIndex, toAddItemIndex, clickedItem, children, {foundSomething: false}, {foundSomething: false});

                    //Add all existing element
                    for (let i = 0, ii = filteredItems.length; i < ii; i++) {
                        let filteredItem = filteredItems[i];
                        toAddItemIndex[filteredItem.id] = filteredItem;
                    }

                    let result = [];
                    for (let i = 0, ii = items.length; i < ii; i++) {
                        let item = items[i];
                        if (toAddItemIndex[item.id]) {
                            result.push(item);
                        }
                    }
                    filteredItems = result;
                }
            }

            // get the current page
            let paged;
            if (pagesize) {
                if (filteredItems.length <= pagenum * pagesize) {
                    if (filteredItems.length === 0) {
                        pagenum = 0;
                    } else {
                        pagenum = Math.floor((filteredItems.length - 1) / pagesize);
                    }
                }
                paged = filteredItems.slice(pagesize * pagenum, pagesize * pagenum + pagesize);
            } else {
                paged = filteredItems;
            }
            return {totalRows: filteredItems.length, rows: paged};
        }

        function addChildrenRecursively(filteredItemIndex, toAddItemIndex, parent, children) {
            for (let i = 0, ii = children.length; i < ii; i++) {
                let child = children[i];
                if (child === undefined) {
                    console.log("asdf");
                }
                if (filteredItemIndex[child.id]) {
                    toAddItemIndex[child.id] = child;
                }
                if (!child._collapsed) {
                    addChildrenRecursively(filteredItemIndex, toAddItemIndex, child, getChildren(child));
                }
            }
            //Add all of them if none are found
            if (toAddItemIndex[parent.id]) {
                let addAll = true;
                for (let i = 0, ii = children.length; i < ii; i++) {
                    let child = children[i];
                    if (toAddItemIndex[child.id]) {
                        addAll = false;
                        break;
                    }
                }
                if (addAll) {
                    for (let i = 0, ii = children.length; i < ii; i++) {
                        let child = children[i];
                        toAddItemIndex[child.id] = child;
                    }
                }
            }
        }

        function removeItemsWithCollapsedParent(items) {
            let tempFilteredItemIndex = {};
            for (let i = 0, ii = items.length; i < ii; i++) {
                let item = items[i];
                if (item.parent !== null) {
                    // let parent = getItemByIdx(item.parent);
                    let parent = getItemById(item.parent);
                    let add = true;
                    while (parent) {
                        if (parent._collapsed) {
                            add = false;
                            break;
                        }
                        // parent = getItemByIdx(parent.parent);
                        parent = getItemById(parent.parent);
                    }
                    if (add) {
                        tempFilteredItemIndex[item.id] = item;
                    }
                } else {
                    tempFilteredItemIndex[item.id] = item;
                }
            }
            let result = [];
            for (let i = 0, ii = items.length; i < ii; i++) {
                let item = items[i];
                if (tempFilteredItemIndex[item.id]) {
                    result.push(item);
                }
            }
            return result;
        }

        function uncollapseParents(items, filteredItems) {
            let tempFilteredItemIndex = {};
            //There is filtering, so un-collapse parents and add them to the filteredItems.
            for (let i = 0, ii = filteredItems.length; i < ii; i++) {
                let item = filteredItems[i];
                item._collapsed = true;
                updated[item.id] = true;
                tempFilteredItemIndex[item.id] = item;
                if (item.parent !== null) {
                    // let parent = items[item.parent];
                    let parent = getItemById(item.parent);
                    while (parent) {
                        tempFilteredItemIndex[parent.id] = parent;
                        if (parent._collapsed) {
                            //this updated logic is needed for the refresh to know to update the row, else the collapsed indicator icon does not change.
                            updated[parent.id] = true;
                            parent._collapsed = false;
                        }
                        // parent = items[parent.parent];
                        parent = getItemById(parent.parent);
                    }
                }
            }
            let result = [];
            for (let i = 0, ii = items.length; i < ii; i++) {
                let item = items[i];
                if (tempFilteredItemIndex[item.id]) {
                    result.push(item);
                } else {
                    item._collapsed = true;
                }
            }
            return result;
        }

        function getRowDiffs(rows, newRows) {
            var item, r, eitherIsNonData, diff = [];
            var from = 0, to = newRows.length;

            if (refreshHints && refreshHints.ignoreDiffsBefore) {
                from = Math.max(0,
                    Math.min(newRows.length, refreshHints.ignoreDiffsBefore));
            }

            if (refreshHints && refreshHints.ignoreDiffsAfter) {
                to = Math.min(newRows.length,
                    Math.max(0, refreshHints.ignoreDiffsAfter));
            }

            for (var i = from, rl = rows.length; i < to; i++) {
                if (i >= rl) {
                    diff[diff.length] = i;
                } else {
                    item = newRows[i];
                    r = rows[i];

                    if ((groupingInfos.length && (eitherIsNonData = (item.__nonDataRow) || (r.__nonDataRow)) &&
                        item.__group !== r.__group ||
                        item.__group && !item.equals(r))
                        || (eitherIsNonData &&
                            // no good way to compare totals since they are arbitrary DTOs
                            // deep object comparison is pretty expensive
                            // always considering them 'dirty' seems easier for the time being
                            (item.__groupTotals || r.__groupTotals))
                        || item[idProperty] != r[idProperty]
                        || (updated && updated[item[idProperty]])
                    ) {
                        diff[diff.length] = i;
                    }
                }
            }
            return diff;
        }

        function recalc(_items) {
            rowsById = null;

            if (refreshHints.isFilterNarrowing != prevRefreshHints.isFilterNarrowing ||
                refreshHints.isFilterExpanding != prevRefreshHints.isFilterExpanding) {
                filterCache = [];
            }

            var filteredItems = getFilteredAndPagedItems(_items);
            totalRows = filteredItems.totalRows;
            var newRows = filteredItems.rows;

            groups = [];
            if (groupingInfos.length) {
                groups = extractGroups(newRows);
                if (groups.length) {
                    addTotals(groups);
                    newRows = flattenGroupedRows(groups);
                }
            }

            var diff = getRowDiffs(rows, newRows);

            rows = newRows;

            return diff;
        }

        function refresh() {
            if (suspend) {
                return;
            }

            var countBefore = rows.length;
            var totalRowsBefore = totalRows;

            var diff = recalc(items, filter); // pass as direct refs to avoid closure perf hit

            // if the current page is no longer valid, go to last page and recalc
            // we suffer a performance penalty here, but the main loop (recalc) remains highly optimized
            if (pagesize && totalRows < pagenum * pagesize) {
                pagenum = Math.max(0, Math.ceil(totalRows / pagesize) - 1);
                diff = recalc(items, filter);
            }

            updated = null;
            prevRefreshHints = refreshHints;
            refreshHints = {};

            if (totalRowsBefore !== totalRows) {
                onPagingInfoChanged.notify(getPagingInfo(), null, self);
            }
            if (countBefore !== rows.length) {
                onRowCountChanged.notify({previous: countBefore, current: rows.length, dataView: self}, null, self);
            }
            if (diff.length > 0) {
                onRowsChanged.notify({rows: diff, dataView: self}, null, self);
            }
        }

        /***
         * Wires the grid and the DataView together to keep row selection tied to item ids.
         * This is useful since, without it, the grid only knows about rows, so if the items
         * move around, the same rows stay selected instead of the selection moving along
         * with the items.
         *
         * NOTE:  This doesn't work with cell selection model.
         *
         * @param grid {Slick.Grid} The grid to sync selection with.
         * @param preserveHidden {Boolean} Whether to keep selected items that go out of the
         *     view due to them getting filtered out.
         * @param preserveHiddenOnSelectionChange {Boolean} Whether to keep selected items
         *     that are currently out of the view (see preserveHidden) as selected when selection
         *     changes.
         * @return {Slick.Event} An event that notifies when an internal list of selected row ids
         *     changes.  This is useful since, in combination with the above two options, it allows
         *     access to the full list selected row ids, and not just the ones visible to the grid.
         * @method syncGridSelection
         */
        //copied from slick.grid's dataview
        function syncGridSelection(grid, preserveHidden, preserveHiddenOnSelectionChange) {
            var self = this;
            var inHandler;
            var selectedRangeIds = [];
            var selectedRowIds = self.mapRowsToIds(grid.getSelectedRows());
            var onSelectedRowIdsChanged = new Slick.Event();

            function setSelectedRangeIds(rangeIds) {
                selectedRangeIds = rangeIds;

                let rangeId = selectedRangeIds[0];
                let rowRangeByRow = self.mapIdsToRows([rangeId.fromRowId])[0];
                let hash = {};
                if (!hash[rowRangeByRow]) {  // prevent duplicates
                    hash[rowRangeByRow] = {};
                }
                for (let k = 0; k < grid.getColumns().length; k++) {
                    hash[rowRangeByRow][grid.getColumns()[k].id] = "row_selected";
                }
                grid.setCellCssStyles("row_selected", hash);
            }

            function setSelectedRowIds(rowIds) {
                if (selectedRowIds.join(",") == rowIds.join(",")) {
                    return;
                }

                selectedRowIds = rowIds;

                onSelectedRowIdsChanged.notify({
                    "grid": grid,
                    "ids": selectedRowIds,
                    "dataView": self
                }, new Slick.EventData(), self);
            }

            function getSelectedRowIds() {
                return selectedRowIds;
            }

            function update() {
                if (grid.getSelectionModel() instanceof Slick.CellSelectionModel && selectedRangeIds.length > 0) {
                    inHandler = true;
                    let selectedRanges = [];
                    let foundSelectedRow = false;
                    for (let i = 0; i < selectedRangeIds.length; i++) {
                        let rangeId = selectedRangeIds[i];
                        for (let j = rangeId.fromRowId; j <= rangeId.toRowId; j++) {
                            let rowRangeByRows = self.mapIdsToRows([j]);
                            if (rowRangeByRows.length > 0) {
                                let rowRangeByRow = rowRangeByRows[0];
                                if (j === rangeId.fromRowId) {
                                    foundSelectedRow = true;
                                    //its the top left corner which we take to be the selected row
                                    let hash = {};
                                    if (!hash[rowRangeByRow]) {  // prevent duplicates
                                        hash[rowRangeByRow] = {};
                                    }
                                    for (let k = 0; k < grid.getColumns().length; k++) {
                                        hash[rowRangeByRow][grid.getColumns()[k].id] = "row_selected";
                                    }
                                    grid.setCellCssStyles("row_selected", hash);
                                }
                                selectedRanges.push(
                                    new Slick.Range(rowRangeByRow, rangeId.fromCell, rowRangeByRow, rangeId.toCell)
                                );
                            }
                        }
                    }
                    if (!foundSelectedRow) {
                        grid.removeCellCssStyles("row_selected");
                    }
                    grid.setSelectedRanges(selectedRanges);
                    inHandler = false;
                } else {
                    if (selectedRowIds.length > 0) {
                        inHandler = true;
                        var selectedRows = self.mapIdsToRows(selectedRowIds);
                        if (!preserveHidden) {
                            setSelectedRowIds(self.mapRowsToIds(selectedRows));
                        }
                        grid.setSelectedRows(selectedRows);
                        inHandler = false;
                    }
                }
            }

            grid.onSelectedRowsChanged.subscribe(function (e, args) {
                if (inHandler) {
                    return;
                }
                if (grid.getSelectionModel() instanceof Slick.CellSelectionModel) {
                    let rangeIds = [];
                    let currentSelectedRanges = grid.getSelectionModel().getSelectedRanges();
                    for (let i = 0; i < currentSelectedRanges.length; i++) {
                        let range = currentSelectedRanges[i];
                        let rangeByRowIds = self.mapRowsToIds([range.fromRow, range.toRow]);
                        rangeIds.push({fromRowId: rangeByRowIds[0], fromCell: range.fromCell, toRowId: rangeByRowIds[1], toCell: range.toCell});
                    }
                    setSelectedRangeIds(rangeIds);
                } else {
                    var newSelectedRowIds = self.mapRowsToIds(grid.getSelectedRows());
                    if (!preserveHiddenOnSelectionChange || !grid.getOptions().multiSelect) {
                        setSelectedRowIds(newSelectedRowIds);
                    } else {
                        // keep the ones that are hidden
                        var existing = $.grep(selectedRowIds, function (id) {
                            return self.getRowById(id) === undefined;
                        });
                        // add the newly selected ones
                        setSelectedRowIds(existing.concat(newSelectedRowIds));
                    }
                }
            });

            this.onRowsChanged.subscribe(update);

            this.onRowCountChanged.subscribe(update);

            return {onSelectedRowIdsChanged: onSelectedRowIdsChanged, setSelectedRowIds: setSelectedRowIds, getSelectedRowIds: getSelectedRowIds};
        }
        // function syncGridSelection(grid, preserveHidden, preserveHiddenOnSelectionChange) {
        //     var self = this;
        //     var inHandler;
        //     var selectedRowIds = self.mapRowsToIds(grid.getSelectedRows());
        //     var onSelectedRowIdsChanged = new Slick.Event();
        //
        //     function setSelectedRowIds(rowIds) {
        //         if (selectedRowIds.join(",") == rowIds.join(",")) {
        //             return;
        //         }
        //
        //         selectedRowIds = rowIds;
        //
        //         onSelectedRowIdsChanged.notify({
        //             "grid": grid,
        //             "ids": selectedRowIds,
        //             "dataView": self
        //         }, new Slick.EventData(), self);
        //     }
        //
        //     function update() {
        //         if (selectedRowIds.length > 0) {
        //             inHandler = true;
        //             var selectedRows = self.mapIdsToRows(selectedRowIds);
        //             if (!preserveHidden) {
        //                 setSelectedRowIds(self.mapRowsToIds(selectedRows));
        //             }
        //             grid.setSelectedRows(selectedRows);
        //             inHandler = false;
        //         }
        //     }
        //
        //     grid.onSelectedRowsChanged.subscribe(function (e, args) {
        //         if (inHandler) {
        //             return;
        //         }
        //         var newSelectedRowIds = self.mapRowsToIds(grid.getSelectedRows());
        //         if (!preserveHiddenOnSelectionChange || !grid.getOptions().multiSelect) {
        //             setSelectedRowIds(newSelectedRowIds);
        //         } else {
        //             // keep the ones that are hidden
        //             var existing = $.grep(selectedRowIds, function (id) {
        //                 return self.getRowById(id) === undefined;
        //             });
        //             // add the newly selected ones
        //             setSelectedRowIds(existing.concat(newSelectedRowIds));
        //         }
        //     });
        //
        //     this.onRowsChanged.subscribe(update);
        //
        //     this.onRowCountChanged.subscribe(update);
        //
        //     return onSelectedRowIdsChanged;
        // }

        function syncGridCellCssStyles(grid, key) {
            var hashById;
            var inHandler;

            // since this method can be called after the cell styles have been set,
            // get the existing ones right away
            storeCellCssStyles(grid.getCellCssStyles(key));

            function storeCellCssStyles(hash) {
                hashById = {};
                for (var row in hash) {
                    var id = rows[row][idProperty];
                    hashById[id] = hash[row];
                }
            }

            function update() {
                if (hashById) {
                    inHandler = true;
                    ensureRowsByIdCache();
                    var newHash = {};
                    for (var id in hashById) {
                        var row = rowsById[id];
                        if (row != undefined) {
                            newHash[row] = hashById[id];
                        }
                    }
                    grid.setCellCssStyles(key, newHash);
                    inHandler = false;
                }
            }

            grid.onCellCssStylesChanged.subscribe(function (e, args) {
                if (inHandler) {
                    return;
                }
                if (key != args.key) {
                    return;
                }
                if (args.hash) {
                    storeCellCssStyles(args.hash);
                } else {
                    grid.onCellCssStylesChanged.unsubscribe(styleChanged);
                    self.onRowsChanged.unsubscribe(update);
                    self.onRowCountChanged.unsubscribe(update);
                }
            });

            this.onRowsChanged.subscribe(update);

            this.onRowCountChanged.subscribe(update);
        }

        $.extend(this, {
            // methods
            "beginUpdate": beginUpdate,
            "endUpdate": endUpdate,
            "setPagingOptions": setPagingOptions,
            "getPagingInfo": getPagingInfo,
            "selectChildren": selectChildren,
            "collapseAll": collapseAll,
            "deselectAll": deselectAll,
            "getItems": getItems,
            "getNewItems": getNewItems,
            "getDeletedItems": getDeletedItems,
            "getUpdatedItems": getUpdatedItems,
            "afterSave": afterSave,
            "resetItems": resetItems,
            "setItems": setItems,
            "setFilter": setFilter,
            "getFilter": getFilter,
            "getFilteredItems": getFilteredItems,
            "sort": sort,
            "fastSort": fastSort,
            "reSort": reSort,
            "groupingInterface": setGrouping,
            "setGrouping": setGrouping,
            "getGrouping": getGrouping,
            "groupBy": groupBy,
            "setAggregators": setAggregators,
            "collapseAllGroups": collapseAllGroups,
            "expandAllGroups": expandAllGroups,
            "collapseGroup": collapseGroup,
            "expandGroup": expandGroup,
            "getGroups": getGroups,
            "getIdxById": getIdxById,
            "getRowByItem": getRowByItem,
            "getRowById": getRowById,
            "getItemById": getItemById,
            "getItemByIdx": getItemByIdx,
            "mapItemsToRows": mapItemsToRows,
            "mapRowsToIds": mapRowsToIds,
            "mapIdsToRows": mapIdsToRows,
            "setRefreshHints": setRefreshHints,
            "setFilterArgs": setFilterArgs,
            "addChildren": addChildren,
            "mergeAndSelect": mergeAndSelect,
            "refresh": refresh,
            "updateItem": updateItem,
            "insertItem": insertItem,
            "addItem": addItem,
            "deleteItem": deleteItem,
            "sortedAddItem": sortedAddItem,
            "sortedUpdateItem": sortedUpdateItem,
            "syncGridSelection": syncGridSelection,
            "syncGridCellCssStyles": syncGridCellCssStyles,

            // data provider methods
            "getLength": getLength,
            "getItem": getItem,
            "getItemMetadata": getItemMetadata,

            // events
            "onRowCountChanged": onRowCountChanged,
            "onRowsChanged": onRowsChanged,
            "onPagingInfoChanged": onPagingInfoChanged
        });
    }

})(jQuery);
