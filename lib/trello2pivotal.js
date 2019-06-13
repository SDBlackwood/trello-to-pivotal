/* globals module, console, require, process */

// Write File Synchronously
let fs = require("fs");

// CSV stream writer
let csvWriter = require("csv-write-stream");

/**
 * trello2pivotal
 */
class App {

    /**
     Show app intro banner and set configuration from arguments
     * @param {String} sourcePath of Trello .JSON to read
     * @param {String} targetPath of Pivotal Tracker .CSV to write
     */
    constructor(sourcePath, targetPath) {
        // intro
        console.log("\n");
        console.log("-=[ trello2pivotal ]=-\n");

        // path to read Trello .JSON
        if (!sourcePath || sourcePath.length === 0) {
            throw new Error("Must specify path to read Trello .JSON file.");
        }

        // path to write Pivotal tracker .CSV
        if (!targetPath || targetPath.length === 0) {
            throw new Error("Must specify path to write Pivotal Tracker .CSV file.");
        }

        // parse source data
        this.board = parseJSON(readContent(sourcePath));

        // show Trello board details
        console.log("Trello Board Details:");
        showObjectDetails(this.board);

        // cache member objects from Trello board
        this.checklists = cacheMembers(this.board, "checklists");
        this.labels = cacheMembers(this.board, "labels");
        this.lists = cacheMembers(this.board, "lists");
        this.actions = cacheMembers(this.board, "actions");
        this.members = cacheMembers(this.board, "members");
        // open target writer
        this.csvWriter = createWriteStream(targetPath, this.buildColumnNames());
        this.rowsWritten = 0;
    }


    filterComments(actions){
        let comments = [];
        //Loop the actions and put all type commentCard in the new array
    }
    /**
     Open target file write stream, write CSV, close target file
     */
    run() {
        let cards = this.board.cards;
        let epics = this.board.lists;
        for (let i = 0; i < cards.length; i++) {
            this.writePivotalTrackerRow(cards[i], epics);      
        }
        for (let i = 0; i < epics.length; i++) {
            this.buildEpics(epics[i]);
        }

        this.csvWriter.end();
        console.log("Wrote " + this.rowsWritten + " rows to CSV file.\n");
    }

    cardOwnerItems(card){
        let owners = [];
        if (card.idMembers !== null) {
            var idMembers = card.idMembers;
            for (const id in idMembers) {
                if (idMembers.hasOwnProperty(id)) {
                    owners.push(this.getMemberName(idMembers[id]));
                }
            }
        }  
        return owners;
    }

    getMemberName(memberID){
        for (const id in this.members) {
            if (this.members.hasOwnProperty(id)) {
                if (this.members[id].id === memberID) {
                    return this.members[id].fullName;
                }
            }
        }
        return "Unknown";
    }

    cardCommentItems(card){
        // retunr list of actions list of text values
        let comments = [];
        for (let id in this.actions) {
            if (this.actions.hasOwnProperty(id)) {
                //console.log("Comments ", this.actions[id]);
                if (this.actions[id].type === 'commentCard') {
                    if (this.actions[id].data.card.id === card.id) {
                        comments.push(this.actions[id]);                   
                    }
                }
            }
        }
        return orderComments(comments);
    }



    cardCopyItems(card){
        // retunr list of actions list of text values
        let comments = [];
        for (let id in this.actions) {
            if (this.actions.hasOwnProperty(id)) {
                if (this.actions[id].type === 'copyCard') {
                    if (this.actions[id].data.card.id === card.id) {
                        comments.push(this.actions[id]);                   
                    }
                }
            }
        }

    }
    /**
     * 
     * @param {Object} list from Trello Board 
     */
    buildEpics(epic){

        let cards = '';
        let type = 'epic';
        let state = '';
        let columnValues = [
            csvValueSafe(epic.name),
            csvValueSafe(type),
            csvValueSafe( epic.name),
            csvValueSafe(''),
            csvValueSafe(state),
            csvValueSafe(cardCreatedAt(epic, state)),
            csvValueSafe(cardAcceptedAt(epic, state)),
            0 // Estimate
        ];
 
        this.csvWriter.write(columnValues);
        this.rowsWritten++;

    }

    /**
     Write one row of Pivotal Tracker CSV -- headers are implied by object keys
     * @param {Object} card from Trello Board
     */
    writePivotalTrackerRow(card) {

        let checklistItems = this.cardChecklistItems(card);
        let commentItems = this.cardCommentItems(card);
        let owners = this.cardOwnerItems(card);
        let labels = this.cardLabelList(card);
        let type = this.cardTypeList(labels);
        let state = this.cardStateLabels(card, type);
        let columnValues = [
            csvValueSafe(cardName(card)),
            csvValueSafe(type),
            csvValueSafe(cardDescription(card)),
            csvValueSafe(labels),
            csvValueSafe(state),
            csvValueSafe(cardCreatedAt(card, state)),
            csvValueSafe(cardAcceptedAt(card, state)),
            0 // Estimate
        ];

        for (let taskNum = 0; taskNum <= this.maxTasks(); taskNum++) {
            columnValues.push(csvValueSafe(taskFromItem(checklistItems[taskNum])));
            columnValues.push(csvValueSafe(taskStatusFromItem(checklistItems[taskNum])));
        };
        for (let ownerNumber = 0; ownerNumber <= 9;  ownerNumber++) {
            columnValues.push(csvValueSafe(ownerFromItem(owners[ownerNumber])));
         };
        for (let commentNumber = 0; commentNumber <= this.maxComments(); commentNumber++) {
            columnValues.push(csvValueSafe(commentFromItem(commentItems[commentNumber])));
        };


        this.csvWriter.write(columnValues);
        this.rowsWritten++;
    }
    
    /**
     * Define the max number of comments
     * This is hardcoded
     * TODO: like maxTasks, identify the make number of comments on a card
     */
    maxComments(){
        return 50;
    }
    /**
     Get the maximum # of tasks (items) for any checklist; takes into account that a card can have multiple checklists, so the max number of tasks per card is greater than for any one checklist.
     1. add up total # checklist items for each card (may sum multiple checklists for one card)
     2. determine the max # of tasks for any one checklist
     */
    maxTasks() {
        if (!this._maxTasks) {
            let cardTotals = {};
            for (let id in this.checklists) {
                if (this.checklists.hasOwnProperty(id)) {
                    let cardId = this.checklists[id].idCard;
                    let checklistTotal = this.checklists[id].checkItems.length;
                    if (cardId in cardTotals) {
                        cardTotals[cardId] += checklistTotal;
                    } else {
                        cardTotals[cardId] = checklistTotal;
                    }
                }
            }
            this._maxTasks = 0;
            for (let id in cardTotals) {
                if (cardTotals.hasOwnProperty(id)) {
                    this._maxTasks = Math.max(this._maxTasks, cardTotals[id]);
                }
            }
            console.log("Will allocate " + this._maxTasks + " Task/Status column pairs.\n");
        }

        return this._maxTasks;
    }

    /**
     Get the Type of a Trello card, inferred from its labels.
     * @param {Object} card from Trello
     * @returns {String} feature, bug, chore, epic, release -- If empty or omitted, the story type will default to feature.
     */
    cardType(card) {
        let type = TYPE_FEATURE;
        for (let i = 0; i < card.idLabels.length; i++) {
            let name = this.labels[card.idLabels[i]].name;
            if (name && name.length > 0) {
                let sanitizedName = name.toLowerCase().trim();
                if (sanitizedName === "bug" || sanitizedName === "fire" || sanitizedName === "impact") {
                    type = TYPE_BUG;
                }
                if (sanitizedName === 'tech debt' || sanitizedName === "operations") {
                    type = TYPE_CHORE;
                }
            }
        }
        return type;
    }

    cardTypeList(list) {
        let type = TYPE_FEATURE;
 
            if (list != '') {
                let sanitizedName = list.toLowerCase();
                if (contains(sanitizedName, 'bug')){
                    type = TYPE_BUG;
                }
                if (contains(sanitizedName, 'debt')){
                    type = TYPE_CHORE;
                }

            }
        return type;
    }


    /**
     Get the Labels of a Trello card
     * @param {Object} card from Trello
     * @returns {String} comma-separated list of labels
     */
    cardLabelList(card) {

        let due_date = '';

        if (card.due != null){
            due_date = card.due;
        }

        let list = [];
        let epic = this.getEpicName(card.idList);
        for (let i = 0; i < card.idLabels.length; i++) {
            let name = ('name' in this.labels[card.idLabels[i]]) ? this.labels[card.idLabels[i]]['name'] : 'unnamed';
            if (name && name.length > 0) {
                list.push(name);
            }
            
        }

        if (due_date != ''){
            
            var date = due_date.split('T')[0];
           
            list.push(date);
        }
        list.push(epic);

        
        return list.join(", ");
    }
    /**
     * Get the name of a Trello list by ID
     * @param {String} id 
     */
    getEpicName(id){

        let epics = this.board.lists;
        let name = '';

        for (let i = 0; i < epics.length; i++) {
         if (epics[i].id === id){
            name = epics[i].name;
         }  
        }

        return name;

    }

    /**
     State of final Pivotal Tracker issue, from Trello card
     - state based on list the card belongs to
     - if in "done" or "released" list -- Accepted
     - if list is closed - Accepted
     - if in "review" list and NOT a Chore -- Delivered
     - if in "active" list -- Started
     - if in "ready" list -- Unstarted
     - if in "backlog" or "icebox" list -- Unscheduled
     - Chore can only have the following states: unscheduled, unstarted, started, accepted
     * @param {Object} card from Trello
     * @param {String} type of Pivotal Tracker issue
     * @returns {String} unscheduled, unstarted, started, finished, delivered, accepted, rejected
     */
    cardState(card, type) {
        let list = this.lists[card.idList];
        let listName = list.name.toLowerCase();
        if (contains(listName, "done") || contains(listName, "released")) {
            return STATE_ACCEPTED;

        } else if (list.closed) {
            return STATE_ACCEPTED;

        } else if (contains(listName, "review")) {
            if (type === TYPE_CHORE) {
                return STATE_STARTED;
            } else {
                return STATE_DELIVERED;
            }

        } else if (contains(listName, "active")) {
            return STATE_STARTED;
        } else if (contains(listName, "started")) {
            return STATE_STARTED;

        } else if (contains(listName, "ready")) {
            return STATE_UNSTARTED;

        } else if (contains(listName, "backlog") || contains(listName, "icebox")) {
            return STATE_UNSCHEDULED;
        }

        return card.closed ? STATE_ACCEPTED : STATE_UNSCHEDULED;
    }

    cardStateLabels(card, type) {

        let list = this.lists[card.idList];
     
        let listName = list.name.toLowerCase();

        // Check labels for cards state - in addition to list header
        for (let i = 0; i < card.idLabels.length; i++) {
            let name = ('name' in this.labels[card.idLabels[i]]) ? this.labels[card.idLabels[i]]['name'] : 'unnamed';
            if (name && name.length > 0) {
                name = name.toLowerCase();
                if (name === 'done'){
                    return STATE_ACCEPTED;
                }
                else if (name === 'started'){
                    return STATE_STARTED;
                    
                }
                else if (name === 'on stage'){
                    return STATE_STARTED;
                    
                }
                else if (name === 'on dev'){
                    return STATE_STARTED;
                    
                }
        }
    }

        if (contains(listName, "done") || contains(listName, "released")) {
            return STATE_ACCEPTED;

        } else if (list.closed) {
            return STATE_ACCEPTED;

        } else if (contains(listName, "review")) {
            if (type === TYPE_CHORE) {
                return STATE_STARTED;
            } else {
                return STATE_DELIVERED;
            }

        } else if (contains(listName, "active")) {
            return STATE_STARTED;
        } else if (contains(listName, "started")) {
            return STATE_STARTED;
        } else if (contains(listName, "ready")) {
            return STATE_UNSTARTED;

        } else if (contains(listName, "backlog") || contains(listName, "icebox")) {
            return STATE_UNSCHEDULED;
        }

        return card.closed ? STATE_ACCEPTED : STATE_UNSCHEDULED;
    }

    /**
     All tasks from a given Trello card
     * @param {Object} card
     */
    cardChecklistItems(card) {
        let items = [];
        for (let id in this.checklists) {
            if (this.checklists.hasOwnProperty(id)) {
                if (this.checklists[id].idCard === card.id) {
                    if (contains(card.name, 'TB04')){
                        console.log("Here is:",card.id);
                    }
                    for (let n = 0; n < this.checklists[id].checkItems.length; n++) {
                        items.push(this.checklists[id].checkItems[n]);
                    }
                }
            }
        }
        return items;
    }

    /**
     Write the header row of a Pivotal Tracker CSV; NOTE that "Task" and "Task Status" columns are repeated with the same name
     @returns {Array} of column names
     */
    buildColumnNames() {
        let columnNames = [
            "Title",
            "Type",
            "Description",
            "Labels",
            'Current State',
            'Created at',
            'Accepted at',
            "Estimate" 
        ];
        for (let taskNum = 1; taskNum <= this.maxTasks(); taskNum++) {
            columnNames.push("Task");
            columnNames.push('Task Status');
        }
        // SB: Adding a loop that will add 10 owners to the header.  
        for (let ownerNumber = 0; ownerNumber <= 9; ownerNumber++) {
            columnNames.push("Owned By");
        }
        // SB: Adding a loop that will add 50 comments to the header.  Each row will now allow 50 comments wheter or not it uses it.
        for (let commentNumber = 0; commentNumber <= this.maxComments(); commentNumber++) {
            columnNames.push("Comment");
        }
        console.log("Will allocate " + columnNames.length + " column names for CSV file.\n");
        return columnNames;
    }
}

function orderComments(comments) {
    
    comments.sort(function(a, b) {
        a = new Date(a.date);
        b = new Date(b.date);
        return a>b ? -1 : a<b ? 1 : 0;
    });
    return comments.reverse();
}

/*
 Show object details
 * @param {Object} obj
 */
function showObjectDetails(obj) {
    for (let k in obj) {
        if (typeof obj[k] === "string") {
            console.log("  " + k + ": " + obj[k]);
        } else if (obj[k] && obj[k].length) {
            console.log("  " + k + "(" + obj[k].length + ")");
        }
    }
    console.log("");
}

/**
 Read Trello export .JSON file
 * @param {String} path of content to read
 * @returns {*}
 */
function readContent(path) {
    let content = fs.readFileSync(path);
    if (!content || content.length === 0) {
        console.error("Error! Trello .JSON file was empty: " + path + "\n");
        process.exit(1);
    }
    console.log("Did read " + content.length + " bytes from Trello .JSON file: " + path + "\n");
    return content;
}

/**
 Parse Trello export JSON (from file content)
 * @param {String} content
 * @returns {Object}
 */
function parseJSON(content) {
    try {
        let obj = JSON.parse(content);
        console.log("Did parse Trello board from JSON.\n");
        return obj;
    } catch (err) {
        console.error("Error! Trello board input was not valid JSON: " + err + "\n");
        process.exit(1);
    }
}

/**
 Get Keyed Objects in Attr
 * @param {Object} obj to get member of
 * @param {String} attr name of member
 * @returns {Object} object containing member objects keyed by checklist id
 */
function cacheMembers(obj, attr) {
    let memberObjectsKeyedById = {};
    for (let i = 0; i < obj[attr].length; i++) {
        memberObjectsKeyedById[obj[attr][i].id] = obj[attr][i];
    }
    console.log("Did cache " + Object.keys(memberObjectsKeyedById).length + " " + attr + ".\n");
    return memberObjectsKeyedById;
}

/**
 Create CSV write stream
 @param {String} path to target CSV
 @param {Array} columnNames to write to CSV header
 */
function createWriteStream(path, columnNames) {
    let writer = csvWriter({headers: columnNames});
    writer.pipe(fs.createWriteStream(path));
    return writer;
}

/**
 * Get the Name of a Trello card
 * @param {Object} card
 */
function cardName(card) {
    return card.name;
}

function listName(card) {
    return card.name;
}

/**
 Get the Description of a Trello card, including links to the Short URL and any attachments.
 * @param {Object} card
 */
function cardDescription(card) {
    let desc = card.desc;
    desc += "\n\nImported from Trello Card: " + card.url;
    for (let i = 0; i < card.attachments.length; i++) {
        desc += "\n\nAttachment: " + card.attachments[i].url;
    }
    return desc;
}

/**
 Date the Pivotal Tracker issue was created at, based on the Trello card
 * @param card
 * @param state
 * @returns {String} date created
 */
function cardCreatedAt(card, state) {
    switch (state) {
        case STATE_UNSCHEDULED:
        case STATE_UNSTARTED:
        case STATE_DELIVERED:
        case STATE_STARTED:
            return card.dateLastActivity;

        case STATE_ACCEPTED:
            return "";
    }
}

/**
 Date the Pivotal Tracker issue was accepted at, based on the Trello card
 * @param card
 * @param state
 * @returns {String} date accepted
 */
function cardAcceptedAt(card, state) {
    switch (state) {
        case STATE_UNSCHEDULED:
        case STATE_UNSTARTED:
        case STATE_DELIVERED:
        case STATE_STARTED:
            return "";

        case STATE_ACCEPTED:
            return card.dateLastActivity;
    }
}
/**
 Task from Trello checklist item;  empty string if input undefined; takes into account that a card can have multiple checklists, and so the max number of tasks per card is greater than for any one checklist
 * @param {Object} item from Trello checklist
 */
function commentFromItem(item) {
    if (item && "data" in item) {
        return createComment(item);
    }

    return "";
}
function ownerFromItem(item) {
    if (item) {
        return item;
    }

    return "";
}
function createComment(item){
    var comment;
    var date = new Date(item.date);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    var month = months[date.getMonth()];
    var seconds = formatDate(date.getSeconds());
    var minutes = formatDate(date.getMinutes());
    var hours = formatDate(date.getHours());
    var dateString = `${month} ${date.getDate()}, ${date.getFullYear()}`;
    var time = `${hours}:${minutes}:${seconds}`;
    comment = `${item.data.text} \n*Created at: ${time}, ${dateString}* (${item.memberCreator.fullName} - ${dateString})`;
    return comment;
}
function formatDate(value){
    if (value < 10) {
        value = "0" + value;
      }
    return value;
}
/**
 Task from Trello checklist item;  empty string if input undefined; takes into account that a card can have multiple checklists, and so the max number of tasks per card is greater than for any one checklist
 * @param {Object} item from Trello checklist
 */
function taskFromItem(item) {
    if (item && "name" in item) {
        return item.name;
    }

    return "";
}

/**
 Task Status from Trello checklist item; empty string if input undefined; takes into account that a card can have multiple checklists, and so the max number of tasks per card is greater than for any one checklist
 * @param {Object} item from Trello checklist
 */
function taskStatusFromItem(item) {
    if (item && "state" in item) {
        return item.state.toLowerCase().trim() === "complete" ? STATUS_COMPLETED : STATUS_NOT_COMPLETED;
    }

    return "";
}

/**
 * Escape quotes
 * @param text
 * @returns {string|XML|*|void}
 */
function csvValueSafe(text) {
    // no known issues, thanks to CSV-stream writer
    return text;
}

/**
 String contains a string?
 * @param {String} haystack to search
 * @param {String} needle to look for
 * @returns {boolean} if found
 */
function contains(haystack, needle) {
    return haystack.indexOf(needle) > -1;
}

/**
 Pivotal Tracker issue type constants
 * @type {string}
 */
const TYPE_BUG = "Bug";
const TYPE_CHORE = "Chore";
const TYPE_FEATURE = "Feature";

/**
 Pivotal Tracker issue state constants
 * @type {string}
 */
const STATE_UNSCHEDULED = "Unscheduled";
const STATE_UNSTARTED = "Unstarted";
const STATE_STARTED = "Started";
// const STATE_FINISHED = "Finished";
const STATE_DELIVERED = "Delivered";
const STATE_ACCEPTED = "Accepted";
// const STATE_REJECTED = "Rejected";

/**
 Pivotal Tracker task status constants
 * @type {string}
 */
const STATUS_COMPLETED = "completed";
const STATUS_NOT_COMPLETED = "Not Completed";

/**
 * Export
 * @param {String} sourcePath of Trello .JSON to read
 * @param {String} targetPath of Pivotal Tracker .CSV to write
 * @returns {App}
 */
module.exports = function (sourcePath, targetPath) {
    return new App(sourcePath, targetPath);
};
