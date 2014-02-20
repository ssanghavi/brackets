/*
 * Copyright (c) 2012 Adobe Systems Incorporated. All rights reserved.
 *  
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"), 
 * to deal in the Software without restriction, including without limitation 
 * the rights to use, copy, modify, merge, publish, distribute, sublicense, 
 * and/or sell copies of the Software, and to permit persons to whom the 
 * Software is furnished to do so, subject to the following conditions:
 *  
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *  
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, 
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER 
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING 
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER 
 * DEALINGS IN THE SOFTWARE.
 * 
 */

/*jslint vars: true, plusplus: true, devel: true, browser: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $ */


/**
 * Text-editing commands that apply to whichever Editor is currently focused
 */
define(function (require, exports, module) {
    "use strict";

    // Load dependent modules
    var Commands           = require("command/Commands"),
        Strings            = require("strings"),
        CommandManager     = require("command/CommandManager"),
        EditorManager      = require("editor/EditorManager"),
        StringUtils        = require("utils/StringUtils"),
        TokenUtils         = require("utils/TokenUtils"),
        CodeMirror         = require("thirdparty/CodeMirror2/lib/codemirror"),
        _                  = require("thirdparty/lodash");
    
    /**
     * List of constants
     */
    var DIRECTION_UP    = -1;
    var DIRECTION_DOWN  = +1;
    
    
    /**
     * @private
     * Creates regular expressions for multiple line comment prefixes
     * @param {!Array.<string>} prefixes - the line comment prefixes
     * @return {Array.<RegExp>}
     */
    function _createLineExpressions(prefixes) {
        var lineExp = [];
        prefixes.forEach(function (prefix) {
            lineExp.push(new RegExp("^\\s*" + StringUtils.regexEscape(prefix)));
        });
        return lineExp;
    }
    
    /**
     * @private
     * Returns true if any regular expression matches the given string
     * @param {!string} string - where to look
     * @param {!Array.<RegExp>} expressions - what to look
     * @return {boolean}
     */
    function _matchExpressions(string, expressions) {
        return expressions.some(function (exp) {
            return string.match(exp);
        });
    }
    
    /**
     * @private
     * Returns the line comment prefix that best matches the string. Since there might be line comment prefixes
     * that are prefixes of other line comment prefixes, it searches throught all and returns the longest line
     * comment prefix that matches the string.
     * @param {!string} string - where to look
     * @param {!Array.<RegExp>} expressions - the line comment regular expressions
     * @param {!Array.<string>} prefixes - the line comment prefixes
     * @return {string}
     */
    function _getLinePrefix(string, expressions, prefixes) {
        var result = null;
        expressions.forEach(function (exp, index) {
            if (string.match(exp) && ((result && result.length < prefixes[index].length) || !result)) {
                result = prefixes[index];
            }
        });
        return result;
    }
    
    /**
     * @private
     * Searchs for an uncommented line between startLine and endLine
     * @param {!Editor} editor
     * @param {!number} startLine - valid line inside the document
     * @param {!number} endLine - valid line inside the document
     * @param {!Array.<string>} lineExp - an array of line comment prefixes regular expressions
     * @return {boolean} true if there is at least one uncommented line
     */
    function _containsUncommented(editor, startLine, endLine, lineExp) {
        var containsUncommented = false;
        var i;
        var line;
        
        for (i = startLine; i <= endLine; i++) {
            line = editor.document.getLine(i);
            // A line is commented out if it starts with 0-N whitespace chars, then a line comment prefix
            if (line.match(/\S/) && !_matchExpressions(line, lineExp)) {
                containsUncommented = true;
                break;
            }
        }
        return containsUncommented;
    }
    
    /**
     * Add or remove line-comment tokens to all the lines in the selected range, preserving selection
     * and cursor position. Applies to currently focused Editor.
     * 
     * If all non-whitespace lines are already commented out, then we uncomment; otherwise we comment
     * out. Commenting out adds the prefix at column 0 of every line. Uncommenting removes the first prefix
     * on each line (if any - empty lines might not have one).
     *
     * @param {!Editor} editor
     * @param {!Array.<string>} prefixes, e.g. ["//"]
     */
    function lineCommentPrefix(editor, prefixes) {
        var doc       = editor.document,
            sel       = editor.getSelection(),
            startLine = sel.start.line,
            endLine   = sel.end.line,
            lineExp   = _createLineExpressions(prefixes);
        
        // Is a range of text selected? (vs just an insertion pt)
        var hasSelection = (startLine !== endLine) || (sel.start.ch !== sel.end.ch);
        
        // In full-line selection, cursor pos is start of next line - but don't want to modify that line
        if (sel.end.ch === 0 && hasSelection) {
            endLine--;
        }
        
        // Decide if we're commenting vs. un-commenting
        // Are there any non-blank lines that aren't commented out? (We ignore blank lines because
        // some editors like Sublime don't comment them out)
        var containsUncommented = _containsUncommented(editor, startLine, endLine, lineExp);
        var i;
        var line;
        var prefix;
        var commentI;
        var updateSelection = false;
        
        // Make the edit
        doc.batchOperation(function () {
            
            if (containsUncommented) {
                // Comment out - prepend the first prefix to each line
                for (i = startLine; i <= endLine; i++) {
                    doc.replaceRange(prefixes[0], {line: i, ch: 0});
                }
                
                // Make sure selection includes the prefix that was added at start of range
                if (sel.start.ch === 0 && hasSelection) {
                    updateSelection = true;
                }
            
            } else {
                // Uncomment - remove the prefix on each line (if any)
                for (i = startLine; i <= endLine; i++) {
                    line   = doc.getLine(i);
                    prefix = _getLinePrefix(line, lineExp, prefixes);
                    
                    if (prefix) {
                        commentI = line.indexOf(prefix);
                        doc.replaceRange("", {line: i, ch: commentI}, {line: i, ch: commentI + prefix.length});
                    }
                }
            }
        });
        
        // Update the selection after the document batch so it's not blown away on resynchronization
        // if this editor is not the master editor.
        if (updateSelection) {
            // use *current* selection end, which has been updated for our text insertions
            editor.setSelection({line: startLine, ch: 0}, editor.getSelection().end);
        }
    }
    
    
    /**
     * @private
     * Moves the token context to the token that starts the block-comment. Ctx starts in a block-comment.
     * Returns the position of the prefix or null if gets to the start of the document and didn't found it.
     * @param {!{editor:{CodeMirror}, pos:{ch:{string}, line:{number}}, token:{object}}} ctx - token context
     * @param {!RegExp} prefixExp - a valid regular expression
     * @return {?{line: number, ch: number}}
     */
    function _findCommentStart(ctx, prefixExp) {
        var result = true;
        
        while (result && !ctx.token.string.match(prefixExp)) {
            result = TokenUtils.moveSkippingWhitespace(TokenUtils.movePrevToken, ctx);
        }
        return result ? {line: ctx.pos.line, ch: ctx.token.start} : null;
    }
    
    /**
     * @private
     * Moves the token context to the token that ends the block-comment. Ctx starts in a block-comment.
     * Returns the position of the sufix or null if gets to the end of the document and didn't found it.
     * @param {!{editor:{CodeMirror}, pos:{ch:{string}, line:{number}}, token:{object}}} ctx - token context
     * @param {!RegExp} suffixExp - a valid regular expression
     * @param {!number} suffixLen - length of the suffix
     * @return {?{line: number, ch: number}}
     */
    function _findCommentEnd(ctx, suffixExp, suffixLen) {
        var result = true;
        
        while (result && !ctx.token.string.match(suffixExp)) {
            result = TokenUtils.moveSkippingWhitespace(TokenUtils.moveNextToken, ctx);
        }
        return result ? {line: ctx.pos.line, ch: ctx.token.end - suffixLen} : null;
    }
    
    /**
     * @private
     * Moves the token context to the next block-comment if there is one before end.
     * @param {!{editor:{CodeMirror}, pos:{ch:{string}, line:{number}}, token:{object}}} ctx - token context
     * @param {!{line: number, ch: number}} end - where to stop searching
     * @param {!RegExp} prefixExp - a valid regular expression
     * @return {boolean} - true if it found a block-comment
     */
    function _findNextBlockComment(ctx, end, prefixExp) {
        var index  = ctx.editor.indexFromPos(end),
            inside = ctx.editor.indexFromPos(ctx.pos) <= index,
            result = true;
        
        while (result && inside && !ctx.token.string.match(prefixExp)) {
            result = TokenUtils.moveSkippingWhitespace(TokenUtils.moveNextToken, ctx);
            inside = ctx.editor.indexFromPos(ctx.pos) <= index;
        }
        return result && inside && !!ctx.token.string.match(prefixExp);
    }
    
    /**
     * Add or remove block-comment tokens to the selection, preserving selection
     * and cursor position. Applies to the currently focused Editor.
     * 
     * If the selection is inside a block-comment or one block-comment is inside or partially
     * inside the selection we uncomment; otherwise we comment out.
     * Commenting out adds the prefix before the selection and the suffix after.
     * Uncommenting removes them.
     * 
     * If slashComment is true and the start or end of the selection is inside a line-comment it 
     * will try to do a line uncomment if is not actually inside a bigger block comment and all
     * the lines in the selection are line-commented.
     *
     * @param {!Editor} editor
     * @param {!string} prefix, e.g. "<!--"
     * @param {!string} suffix, e.g. "-->"
     * @param {!Array.<string>} linePrefixes, e.g. ["//"]
     */
    function blockCommentPrefixSuffix(editor, prefix, suffix, linePrefixes) {
        
        var doc            = editor.document,
            sel            = editor.getSelection(),
            ctx            = TokenUtils.getInitialContext(editor._codeMirror, {line: sel.start.line, ch: sel.start.ch}),
            startCtx       = TokenUtils.getInitialContext(editor._codeMirror, {line: sel.start.line, ch: sel.start.ch}),
            endCtx         = TokenUtils.getInitialContext(editor._codeMirror, {line: sel.end.line, ch: sel.end.ch}),
            prefixExp      = new RegExp("^" + StringUtils.regexEscape(prefix), "g"),
            suffixExp      = new RegExp(StringUtils.regexEscape(suffix) + "$", "g"),
            lineExp        = _createLineExpressions(linePrefixes),
            prefixPos      = null,
            suffixPos      = null,
            canComment     = false,
            invalidComment = false,
            lineUncomment  = false,
            newSelection;
        
        var result, text, line;
        
        // Move the context to the first non-empty token.
        if (!ctx.token.type && ctx.token.string.trim().length === 0) {
            result = TokenUtils.moveSkippingWhitespace(TokenUtils.moveNextToken, ctx);
        }
        
        // Check if we should just do a line uncomment (if all lines in the selection are commented).
        if (lineExp.length && (_matchExpressions(ctx.token.string, lineExp) || _matchExpressions(endCtx.token.string, lineExp))) {
            var startCtxIndex = editor.indexFromPos({line: ctx.pos.line, ch: ctx.token.start});
            var endCtxIndex   = editor.indexFromPos({line: endCtx.pos.line, ch: endCtx.token.start + endCtx.token.string.length});
            
            // Find if we aren't actually inside a block-comment
            result = true;
            while (result && _matchExpressions(ctx.token.string, lineExp)) {
                result = TokenUtils.moveSkippingWhitespace(TokenUtils.movePrevToken, ctx);
            }
            
            // If we aren't in a block-comment.
            if (!result || ctx.token.type !== "comment" || ctx.token.string.match(suffixExp)) {
                // Is a range of text selected? (vs just an insertion pt)
                var hasSelection = (sel.start.line !== sel.end.line) || (sel.start.ch !== sel.end.ch);
                
                // In full-line selection, cursor pos is start of next line - but don't want to modify that line
                var endLine = sel.end.line;
                if (sel.end.ch === 0 && hasSelection) {
                    endLine--;
                }
                
                // Find if all the lines are line-commented.
                if (!_containsUncommented(editor, sel.start.line, endLine, lineExp)) {
                    lineUncomment = true;
                
                // Block-comment in all the other cases
                } else {
                    canComment = true;
                }
            } else {
                prefixPos = _findCommentStart(startCtx, prefixExp);
                suffixPos = _findCommentEnd(startCtx, suffixExp, suffix.length);
            }
            
        // If we are in a selection starting and ending in invalid tokens and with no content (not considering spaces),
        // find if we are inside a block-comment.
        } else if (startCtx.token.type === null && endCtx.token.type === null &&
                !editor.posWithinRange(ctx.pos, startCtx.pos, endCtx.pos, true)) {
            result = TokenUtils.moveSkippingWhitespace(TokenUtils.moveNextToken, startCtx);
            
            // We found a comment, find the start and end and check if the selection is inside the block-comment.
            if (startCtx.token.type === "comment") {
                prefixPos = _findCommentStart(startCtx, prefixExp);
                suffixPos = _findCommentEnd(startCtx, suffixExp, suffix.length);
                
                if (prefixPos !== null && suffix !== null && !editor.posWithinRange(sel.start, prefixPos, suffixPos, true)) {
                    canComment = true;
                }
            } else {
                canComment = true;
            }
        
        // If the start is inside a comment, find the prefix and suffix positions.
        } else if (ctx.token.type === "comment") {
            prefixPos = _findCommentStart(ctx, prefixExp);
            suffixPos = _findCommentEnd(ctx, suffixExp, suffix.length);
            
        // If not try to find the first comment inside the selection.
        } else {
            result = _findNextBlockComment(ctx, sel.end, prefixExp);
            
            // If nothing was found is ok to comment.
            if (!result) {
                canComment = true;
            } else {
                if (!ctx.token.string.match(prefixExp)) {
                    prefixPos = _findCommentStart(ctx, prefixExp);
                } else {
                    prefixPos = {line: ctx.pos.line, ch: ctx.token.start};
                }
                suffixPos = _findCommentEnd(ctx, suffixExp, suffix.length);
            }
        }
        
        // Search if there is another comment in the selection. Do nothing if there is one.
        if (!canComment && !invalidComment && !lineUncomment && suffixPos) {
            var start = {line: suffixPos.line, ch: suffixPos.ch + suffix.length + 1};
            if (editor.posWithinRange(start, sel.start, sel.end, true)) {
                // Start searching at the next token, if there is one.
                result = TokenUtils.moveSkippingWhitespace(TokenUtils.moveNextToken, ctx) &&
                         _findNextBlockComment(ctx, sel.end, prefixExp);
                
                if (result) {
                    invalidComment = true;
                }
            }
        }
        
        
        // Make the edit
        if (invalidComment) {
            return;
        
        } else if (lineUncomment) {
            lineCommentPrefix(editor, linePrefixes);
        
        } else {
            doc.batchOperation(function () {
                
                if (canComment) {
                    // Comment out - add the suffix to the start and the prefix to the end.
                    var completeLineSel = sel.start.ch === 0 && sel.end.ch === 0 && sel.start.line < sel.end.line;
                    if (completeLineSel) {
                        doc.replaceRange(suffix + "\n", sel.end);
                        doc.replaceRange(prefix + "\n", sel.start);
                    } else {
                        doc.replaceRange(suffix, sel.end);
                        doc.replaceRange(prefix, sel.start);
                    }
                    
                    // Correct the selection.
                    if (completeLineSel) {
                        newSelection = {start: {line: sel.start.line + 1, ch: 0}, end: {line: sel.end.line + 1, ch: 0}};
                    } else {
                        var newSelStart = {line: sel.start.line, ch: sel.start.ch + prefix.length};
                        if (sel.start.line === sel.end.line) {
                            newSelection = {start: newSelStart, end: {line: sel.end.line, ch: sel.end.ch + prefix.length}};
                        } else {
                            newSelection = {start: newSelStart, end: {line: sel.end.line, ch: sel.end.ch}};
                        }
                    }
                
                // Uncomment - remove prefix and suffix.
                } else {
                    // Find if the prefix and suffix are at the ch 0 and if they are the only thing in the line.
                    // If both are found we assume that a complete line selection comment added new lines, so we remove them.
                    var prefixAtStart = false, suffixAtStart = false;
                    
                    line = doc.getLine(prefixPos.line).trim();
                    prefixAtStart = prefixPos.ch === 0 && prefix.length === line.length;
                    if (suffixPos) {
                        line = doc.getLine(suffixPos.line).trim();
                        suffixAtStart = suffixPos.ch === 0 && suffix.length === line.length;
                    }
                    
                    // Remove the suffix if there is one
                    if (suffixPos) {
                        if (prefixAtStart && suffixAtStart) {
                            doc.replaceRange("", suffixPos, {line: suffixPos.line + 1, ch: 0});
                        } else {
                            doc.replaceRange("", suffixPos, {line: suffixPos.line, ch: suffixPos.ch + suffix.length});
                        }
                    }
                    
                    // Remove the prefix
                    if (prefixAtStart && suffixAtStart) {
                        doc.replaceRange("", prefixPos, {line: prefixPos.line + 1, ch: 0});
                    } else {
                        doc.replaceRange("", prefixPos, {line: prefixPos.line, ch: prefixPos.ch + prefix.length});
                    }
                }
            });
            
            // Update the selection after the document batch so it's not blown away on resynchronization
            // if this editor is not the master editor.
            if (newSelection) {
                editor.setSelection(newSelection.start, newSelection.end);
            }
        }
    }
    
    
    /**
     * Add or remove block-comment tokens to the selection, preserving selection
     * and cursor position. Applies to the currently focused Editor.
     * 
     * The implementation uses blockCommentPrefixSuffix, with the exception of the case where
     * there is no selection on a uncommented and not empty line. In this case the whole lines gets
     * commented in a block-comment.
     *
     * @param {!Editor} editor
     * @param {!String} prefix
     * @param {!String} suffix
     */
    function lineCommentPrefixSuffix(editor, prefix, suffix) {
        var sel             = editor.getSelection(),
            selStart        = sel.start,
            selEnd          = sel.end,
            prefixExp       = new RegExp("^" + StringUtils.regexEscape(prefix), "g"),
            isLineSelection = sel.start.ch === 0 && sel.end.ch === 0 && sel.start.line !== sel.end.line,
            isMultipleLine  = sel.start.line !== sel.end.line,
            lineLength      = editor.document.getLine(sel.start.line).length;
        
        // Line selections already behave like we want to
        if (!isLineSelection) {
            // For a multiple line selection transform it to a multiple whole line selection
            if (isMultipleLine) {
                selStart = {line: sel.start.line, ch: 0};
                selEnd   = {line: sel.end.line + 1, ch: 0};
            
            // For one line selections, just start at column 0 and end at the end of the line
            } else {
                selStart = {line: sel.start.line, ch: 0};
                selEnd   = {line: sel.end.line, ch: lineLength};
            }
        }
        
        // If the selection includes a comment or is already a line selection, delegate to Block-Comment
        var ctx       = TokenUtils.getInitialContext(editor._codeMirror, {line: selStart.line, ch: selStart.ch});
        var result    = TokenUtils.moveSkippingWhitespace(TokenUtils.moveNextToken, ctx);
        var className = ctx.token.type;
        result        = result && _findNextBlockComment(ctx, selEnd, prefixExp);
        
        if (className === "comment" || result || isLineSelection) {
            blockCommentPrefixSuffix(editor, prefix, suffix, []);
        } else {
            // Set the new selection and comment it
            editor.setSelection(selStart, selEnd);
            blockCommentPrefixSuffix(editor, prefix, suffix, []);
            
            // Restore the old selection taking into account the prefix change
            if (isMultipleLine) {
                sel.start.line++;
                sel.end.line++;
            } else {
                sel.start.ch += prefix.length;
                sel.end.ch += prefix.length;
            }
            editor.setSelection(sel.start, sel.end);
        }
    }
    
    
    /**
     * Invokes a language-specific block-comment/uncomment handler
     * @param {?Editor} editor If unspecified, applies to the currently focused editor
     */
    function blockComment(editor) {
        editor = editor || EditorManager.getFocusedEditor();
        if (!editor) {
            return;
        }
        
        var language = editor.getLanguageForSelection();
        
        if (language.hasBlockCommentSyntax()) {
            // getLineCommentPrefixes always return an array, and will be empty if no line comment syntax is defined
            blockCommentPrefixSuffix(editor, language.getBlockCommentPrefix(), language.getBlockCommentSuffix(), language.getLineCommentPrefixes());
        }
    }
    
    /**
     * Invokes a language-specific line-comment/uncomment handler
     * @param {?Editor} editor If unspecified, applies to the currently focused editor
     */
    function lineComment(editor) {
        editor = editor || EditorManager.getFocusedEditor();
        if (!editor) {
            return;
        }
        
        var language = editor.getLanguageForSelection();
        
        if (language.hasLineCommentSyntax()) {
            lineCommentPrefix(editor, language.getLineCommentPrefixes());
        } else if (language.hasBlockCommentSyntax()) {
            lineCommentPrefixSuffix(editor, language.getBlockCommentPrefix(), language.getBlockCommentSuffix());
        }
    }
    
    
    /**
     * Duplicates the selected text, or current line if no selection. The cursor/selection is left
     * on the second copy.
     */
    function duplicateText(editor) {
        editor = editor || EditorManager.getFocusedEditor();
        if (!editor) {
            return;
        }

        var selections = editor.getSelections(),
            delimiter = "",
            edits = [],
            rangeSels = [],
            cursorSels = [],
            doc = editor.document;

        // When there are multiple selections, we want to handle all the cursors first (duplicating
        // their lines), then all the ranges (duplicating the ranges).
        _.each(selections, function (sel) {
            if (CodeMirror.cmpPos(sel.start, sel.end) === 0) {
                cursorSels.push(sel);
            } else {
                rangeSels.push(sel);
            }
        });
        
        _.each(cursorSels, function (sel, index) {
            // Only handle each line once.
            if (index === 0 || sel.start.line > cursorSels[index - 1].start.line) {
                var start = {line: sel.start.line, ch: 0},
                    end = {line: sel.start.line + 1, ch: 0};
                if (end.line === editor.lineCount()) {
                    delimiter = "\n";
                }
                edits.push({edit: {text: doc.getRange(start, end) + delimiter, start: start }});
            }
        });
        _.each(rangeSels, function (sel) {
            edits.push({edit: {text: doc.getRange(sel.start, sel.end), start: sel.start }});
        });

        editor.doMultipleEdits(edits);
    }

    /**
     * Deletes the current line if there is no selection or the lines for the selection
     * (removing the end of line too)
     */
    function deleteCurrentLines(editor) {
        editor = editor || EditorManager.getFocusedEditor();
        if (!editor) {
            return;
        }
        
        // Walk the selections, calculating the deletion edits we need to do as we go;
        // editor.doMultipleEdits() will take care of adjusting the edit locations when
        // it actually performs the edits.
        var doc = editor.document,
            from,
            to,
            selections = editor.getSelections(),
            edits = [];
        
        _.each(selections, function (sel, index) {
            // We only want to delete each line once. So, if a selection is wholly contained
            // in the same line that the previous selection ends on, we skip it. If a selection
            // starts on the same line but continues to future lines, we just bump its start by one.
            // (We know that the selections from getSelections() are guaranteed to be in order
            // and non-overlapping.)
            var selStartLine = sel.start.line;
            if (index > 0 && selStartLine === selections[index - 1].end.line) {
                if (sel.end.line > selStartLine) {
                    selStartLine++;
                } else {
                    selStartLine = null;
                }
            }
            if (selStartLine !== null) {
                from = {line: selStartLine, ch: 0};
                to = {line: sel.end.line + 1, ch: 0};
                if (to.line === editor.getLastVisibleLine() + 1) {
                    // Instead of deleting the newline after the last line, delete the newline
                    // before the beginning of the line--unless this is the entire visible content 
                    // of the editor, in which case just delete the line content.
                    if (from.line > editor.getFirstVisibleLine()) {
                        from.line -= 1;
                        from.ch = doc.getLine(from.line).length;
                    }
                    to.line -= 1;
                    to.ch = doc.getLine(to.line).length;
                }

                edits.push({edit: {text: "", start: from, end: to}});
            }
        });
        editor.doMultipleEdits(edits);
    }
    
    /**
     * Moves the selected text, or current line if no selection. The cursor/selection 
     * moves with the line/lines.
     * @param {Editor} editor - target editor
     * @param {Number} direction - direction of the move (-1,+1) => (Up,Down)
     */
    function moveLine(editor, direction) {
        editor = editor || EditorManager.getFocusedEditor();
        if (!editor) {
            return;
        }
        
        var doc            = editor.document,
            selections     = editor.getSelections(),
            isInlineWidget = !!EditorManager.getFocusedInlineWidget(),
            firstLine      = editor.getFirstVisibleLine(),
            lastLine       = editor.getLastVisibleLine(),
            totalLines     = editor.lineCount(),
            lineLength     = 0,
            edits          = [];
        
        // Combine adjacent lines with selections so they don't collide with each other, as they would
        // if we did them individually.
        var combinedSelections = [], prevSel;
        _.each(selections, function (sel) {
            var originalSel = _.cloneDeep(sel);
            
            // Adjust selection to encompass whole lines.
            sel.start.ch = 0;
            // The end of the selection becomes the start of the next line, if it isn't already
            var hasSelection = (sel.start.line !== sel.end.line) || (sel.start.ch !== sel.end.ch);
            if (!hasSelection || sel.end.ch !== 0) {
                sel.end = {line: sel.end.line + 1, ch: 0};
            }

            // If the start of the new selection is within the range of the previous (expanded) selection, merge
            // the two selections together, but keep track of all the original selections that were related to this
            // selection, so they can be properly adjusted. (We only have to check for the start being inside the previous
            // range - it can't be before it because the selections started out sorted.)
            if (prevSel && editor.posWithinRange(sel.start, prevSel.selectionForEdit.start, prevSel.selectionForEdit.end, true)) {
                prevSel.selectionForEdit.end.line = sel.end.line;
                prevSel.selectionsToTrack.push(originalSel);
            } else {
                prevSel = {selectionForEdit: sel, selectionsToTrack: [originalSel]};
                combinedSelections.push(prevSel);
            }
        });
        
        _.each(combinedSelections, function (combinedSel) {
            var sel = combinedSel.selectionForEdit,
                editGroup = [];

            // Make the move
            switch (direction) {
            case DIRECTION_UP:
                if (sel.start.line !== firstLine) {
                    var prevText = doc.getRange({ line: sel.start.line - 1, ch: 0 }, sel.start);

                    if (sel.end.line === lastLine + 1) {
                        if (isInlineWidget) {
                            prevText   = prevText.substring(0, prevText.length - 1);
                            lineLength = doc.getLine(sel.end.line - 1).length;
                            editGroup.push({text: "\n", start: { line: sel.end.line - 1, ch: lineLength }});
                        } else {
                            prevText = "\n" + prevText.substring(0, prevText.length - 1);
                        }
                    }

                    editGroup.push({text: "", start: { line: sel.start.line - 1, ch: 0 }, end: sel.start});
                    editGroup.push({text: prevText, start: { line: sel.end.line - 1, ch: 0 }});

                    // Make sure CodeMirror hasn't expanded the selection to include
                    // the line we inserted below.
                    _.each(combinedSel.selectionsToTrack, function (originalSel) {
                        originalSel.start.line--;
                        originalSel.end.line--;
                    });

                    edits.push({edit: editGroup, selection: combinedSel.selectionsToTrack});
                }
                break;
            case DIRECTION_DOWN:
                if (sel.end.line <= lastLine) {
                    var nextText      = doc.getRange(sel.end, { line: sel.end.line + 1, ch: 0 }),
                        deletionStart = sel.end;

                    if (sel.end.line === lastLine) {
                        if (isInlineWidget) {
                            if (sel.end.line === totalLines - 1) {
                                nextText += "\n";
                            }
                            lineLength = doc.getLine(sel.end.line - 1).length;
                            editGroup.push({text: "\n", start: { line: sel.end.line, ch: doc.getLine(sel.end.line).length }});
                        } else {
                            nextText     += "\n";
                            deletionStart = { line: sel.end.line - 1, ch: doc.getLine(sel.end.line - 1).length };
                        }
                    }

                    editGroup.push({text: "", start: deletionStart, end: { line: sel.end.line + 1, ch: 0 }});
                    if (lineLength) {
                        editGroup.push({text: "", start: { line: sel.end.line - 1, ch: lineLength }, end: { line: sel.end.line, ch: 0 }});
                    }
                    editGroup.push({text: nextText, start: { line: sel.start.line, ch: 0 }});
                    
                    // In this case, we don't need to track selections, because the edits are done in such a way that
                    // the existing selections will automatically be updated properly by CodeMirror as it does the edits.
                    edits.push({edit: editGroup});
                }
                break;
            }
        });
        if (edits.length) {
            var newSels = editor.doMultipleEdits(edits);
            if (direction === DIRECTION_UP) {
                editor.setSelections(newSels);
            }
        }
    }
    
    /**
     * Moves the selected text, or current line if no selection, one line up. The cursor/selection 
     * moves with the line/lines.
     */
    function moveLineUp(editor) {
        moveLine(editor, DIRECTION_UP);
    }
    
    /**
     * Moves the selected text, or current line if no selection, one line down. The cursor/selection 
     * moves with the line/lines.
     */
    function moveLineDown(editor) {
        moveLine(editor, DIRECTION_DOWN);
    }

    /**
     * Inserts a new and smart indented line above/below the selected text, or current line if no selection.
     * The cursor is moved in the new line.
     * @param {Editor} editor - target editor
     * @param {Number} direction - direction where to place the new line (-1,+1) => (Up,Down)
     */
    function openLine(editor, direction) {
        editor = editor || EditorManager.getFocusedEditor();
        if (!editor) {
            return;
        }
        
        var selections     = editor.getSelections(),
            isInlineWidget = !!EditorManager.getFocusedInlineWidget(),
            lastLine       = editor.getLastVisibleLine(),
            cm             = editor._codeMirror,
            doc            = editor.document,
            edits          = [],
            newSelections,
            line;
        
        // First, insert all the newlines (skipping multiple selections on the same line), 
        // then indent them all. (We can't easily do them all at once, because doMultipleEdits()
        // won't do the indentation for us, but we want its help tracking any selection changes
        // as the result of the edits.)
        
        doc.batchOperation(function () {
            _.each(selections, function (sel, index) {
                if (index === 0 ||
                        (direction === DIRECTION_UP && sel.start.line > selections[index - 1].start.line) ||
                        (direction === DIRECTION_DOWN && sel.end.line > selections[index - 1].end.line)) {
                    // Insert the new line
                    switch (direction) {
                    case DIRECTION_UP:
                        line = sel.start.line;
                        break;
                    case DIRECTION_DOWN:
                        line = sel.end.line;
                        if (!(CodeMirror.cmpPos(sel.start, sel.end) !== 0 && sel.end.ch === 0)) {
                            // If not linewise selection
                            line++;
                        }
                        break;
                    }

                    var insertPos;
                    if (line > lastLine && isInlineWidget) {
                        insertPos = {line: line - 1, ch: doc.getLine(line - 1).length};
                    } else {
                        insertPos = {line: line, ch: 0};
                    }
                    // We want the selection after this edit to be right before the \n we just inserted.
                    edits.push({edit: {text: "\n", start: insertPos}, selection: {start: insertPos, end: insertPos, primary: sel.primary}});
                } else {
                    // We just want to discard this selection, since we've already operated on the
                    // same line and it would just collapse to the same location. But if this was
                    // primary, make sure the last selection we did operate on ends up as primary.
                    if (sel.primary) {
                        edits[edits.length - 1].selections[0].primary = true;
                    }
                }
            });
            newSelections = editor.doMultipleEdits(edits, "+input");
            
            // Now indent each added line (which doesn't mess up any line numbers, and
            // we're going to set the character offset to the last position on each line anyway).
            _.each(newSelections, function (sel) {
                cm.indentLine(sel.start.line, "smart", true);
                sel.start.ch = null; // last character on line
                sel.end = sel.start;
            });
        });
        editor.setSelections(newSelections);
    }

    /**
     * Inserts a new and smart indented line above the selected text, or current line if no selection.
     * The cursor is moved in the new line.
     * @param {Editor} editor - target editor
     */
    function openLineAbove(editor) {
        openLine(editor, DIRECTION_UP);
    }

    /**
     * Inserts a new and smart indented line below the selected text, or current line if no selection.
     * The cursor is moved in the new line.
     * @param {Editor} editor - target editor
     */
    function openLineBelow(editor) {
        openLine(editor, DIRECTION_DOWN);
    }

    /**
     * Indent a line of text if no selection. Otherwise, indent all lines in selection.
     */
    function indentText() {
        var editor = EditorManager.getFocusedEditor();
        if (!editor) {
            return;
        }
        
        editor._codeMirror.execCommand("indentMore");
    }
    
    /**
     * Unindent a line of text if no selection. Otherwise, unindent all lines in selection.
     */
    function unidentText() {
        var editor = EditorManager.getFocusedEditor();
        if (!editor) {
            return;
        }
        
        editor._codeMirror.execCommand("indentLess");
    }

    function selectLine(editor) {
        editor = editor || EditorManager.getFocusedEditor();
        if (editor) {
            editor.setSelections(editor.expandSelectionsToLines(editor.getSelections()));
        }
    }

    function handleUndoRedo(operation) {
        var editor = EditorManager.getFocusedEditor();
        var result = new $.Deferred();
        
        if (editor) {
            editor[operation]();
            result.resolve();
        } else {
            result.reject();
        }
        
        return result.promise();
    }

    function handleUndo() {
        return handleUndoRedo("undo");
    }

    function handleRedo() {
        return handleUndoRedo("redo");
    }

    /**
     * Special command handler that just ignores the command. This is used for Cut, Copy, and Paste.
     * These menu items are handled natively, but need to be registered in our JavaScript code so the 
     * menu items can be created.
     */
    function ignoreCommand() {
        // Do nothing. The shell will call the native handler for the command.
        return (new $.Deferred()).reject().promise();
    }
	
	function _handleSelectAll() {
        var result = new $.Deferred(),
            editor = EditorManager.getFocusedEditor();

        if (editor) {
            editor.selectAllNoScroll();
            result.resolve();
        } else {
            result.reject();    // command not handled
        }

        return result.promise();
    }
        
    // Register commands
    CommandManager.register(Strings.CMD_INDENT,           Commands.EDIT_INDENT,           indentText);
    CommandManager.register(Strings.CMD_UNINDENT,         Commands.EDIT_UNINDENT,         unidentText);
    CommandManager.register(Strings.CMD_COMMENT,          Commands.EDIT_LINE_COMMENT,     lineComment);
    CommandManager.register(Strings.CMD_BLOCK_COMMENT,    Commands.EDIT_BLOCK_COMMENT,    blockComment);
    CommandManager.register(Strings.CMD_DUPLICATE,        Commands.EDIT_DUPLICATE,        duplicateText);
    CommandManager.register(Strings.CMD_DELETE_LINES,     Commands.EDIT_DELETE_LINES,     deleteCurrentLines);
    CommandManager.register(Strings.CMD_LINE_UP,          Commands.EDIT_LINE_UP,          moveLineUp);
    CommandManager.register(Strings.CMD_LINE_DOWN,        Commands.EDIT_LINE_DOWN,        moveLineDown);
    CommandManager.register(Strings.CMD_OPEN_LINE_ABOVE,  Commands.EDIT_OPEN_LINE_ABOVE,  openLineAbove);
    CommandManager.register(Strings.CMD_OPEN_LINE_BELOW,  Commands.EDIT_OPEN_LINE_BELOW,  openLineBelow);
    CommandManager.register(Strings.CMD_SELECT_LINE,      Commands.EDIT_SELECT_LINE,      selectLine);

    CommandManager.register(Strings.CMD_UNDO,             Commands.EDIT_UNDO,             handleUndo);
    CommandManager.register(Strings.CMD_REDO,             Commands.EDIT_REDO,             handleRedo);
    CommandManager.register(Strings.CMD_CUT,              Commands.EDIT_CUT,              ignoreCommand);
    CommandManager.register(Strings.CMD_COPY,             Commands.EDIT_COPY,             ignoreCommand);
    CommandManager.register(Strings.CMD_PASTE,            Commands.EDIT_PASTE,            ignoreCommand);
    CommandManager.register(Strings.CMD_SELECT_ALL,       Commands.EDIT_SELECT_ALL,       _handleSelectAll);
});
