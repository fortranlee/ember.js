/*globals Handlebars, Metamorph:true */
/*jshint newcap:false*/


/**
@module ember
@submodule ember-handlebars
*/

import EmberHandlebars from "ember-handlebars-compiler"; // EmberHandlebars.SafeString;
var SafeString = EmberHandlebars.SafeString;

import Ember from "ember-metal/core"; // Ember.K
var K = Ember.K;

var Metamorph = requireModule('metamorph');
import EmberError from "ember-metal/error";
import { get } from "ember-metal/property_get";
import { set } from "ember-metal/property_set";
import merge from "ember-metal/merge";
import run from "ember-metal/run_loop";
import { computed } from "ember-metal/computed";
import View from "ember-views/views/view";
import {
  cloneStates,
  states
} from "ember-views/views/states";
var viewStates = states;

import { _MorphView } from "ember-htmlbars/views/morph_view";
import { handlebarsGet } from "ember-handlebars/ext";

function SimpleHtmlbarsView(lazyValue, isEscaped, templateData) {
  this.lazyValue = lazyValue;
  this.isEscaped = isEscaped;
  this.templateData = templateData;

  this.morph = Metamorph();
  this.state = 'preRender';
  this.updateId = null;
  this._parentView = null;
  this.buffer = null;
}

SimpleHtmlbarsView.prototype = {
  isVirtual: true,
  isView: true,

  destroy: function () {
    if (this.updateId) {
      run.cancel(this.updateId);
      this.updateId = null;
    }
    if (this._parentView) {
      this._parentView.removeChild(this);
    }
    this.morph = null;
    this.state = 'destroyed';
  },

  propertyWillChange: K,

  propertyDidChange: K,

  normalizedValue: function() {
    return this.lazyValue.value();
  },

  renderToBuffer: function(buffer) {
    var string = '';

    string += this.morph.startTag();
    string += this.render();
    string += this.morph.endTag();

    buffer.push(string);
  },

  render: function() {
    // If not invoked via a triple-mustache ({{{foo}}}), escape
    // the content of the template.
    var escape = this.isEscaped;
    var result = this.normalizedValue();

    if (result === null || result === undefined) {
      result = "";
    } else if (!(result instanceof SafeString)) {
      result = String(result);
    }

    if (escape) { result = Handlebars.Utils.escapeExpression(result); }
    return result;
  },

  rerender: function() {
    switch(this.state) {
      case 'preRender':
      case 'destroyed':
        break;
      case 'inBuffer':
        throw new EmberError("Something you did tried to replace an {{expression}} before it was inserted into the DOM.");
      case 'hasElement':
      case 'inDOM':
        this.updateId = run.scheduleOnce('render', this, 'update');
        break;
    }

    return this;
  },

  update: function () {
    this.updateId = null;
    this.morph.html(this.render());
  },

  transitionTo: function(state) {
    this.state = state;
  }
};

states = cloneStates(viewStates);

merge(states._default, {
  rerenderIfNeeded: K
});

merge(states.inDOM, {
  rerenderIfNeeded: function(view) {
    if (view.normalizedValue() !== view._lastNormalizedValue) {
      view.rerender();
    }
  }
});

/**
  `Ember._HandlebarsBoundView` is a private view created by the Handlebars
  `{{bind}}` helpers that is used to keep track of bound properties.

  Every time a property is bound using a `{{mustache}}`, an anonymous subclass
  of `Ember._HandlebarsBoundView` is created with the appropriate sub-template
  and context set up. When the associated property changes, just the template
  for this view will re-render.

  @class _HandlebarsBoundView
  @namespace Ember
  @extends Ember._MetamorphView
  @private
*/
var _HtmlbarsBoundView = _MorphView.extend({
  instrumentName: 'boundHandlebars',

  _states: states,

  init: function() {
    this._super();

    this.lazyValue.onNotify(function(lv) {
      run.scheduleOnce('render', this, 'rerenderIfNeeded');
    }.bind(this));
  },

  /**
    The function used to determine if the `displayTemplate` or
    `inverseTemplate` should be rendered. This should be a function that takes
    a value and returns a Boolean.

    @property shouldDisplayFunc
    @type Function
    @default null
  */
  shouldDisplayFunc: null,

  /**
    Whether the template rendered by this view gets passed the context object
    of its parent template, or gets passed the value of retrieving `path`
    from the `pathRoot`.

    For example, this is true when using the `{{#if}}` helper, because the
    template inside the helper should look up properties relative to the same
    object as outside the block. This would be `false` when used with `{{#with
    foo}}` because the template should receive the object found by evaluating
    `foo`.

    @property preserveContext
    @type Boolean
    @default false
  */
  preserveContext: false,


  lazyValue: null,

  /**
    If `preserveContext` is true, this is the object that will be used
    to render the template.

    @property previousContext
    @type Object
  */
  previousLazyValue: null,

  /**
    The template to render when `shouldDisplayFunc` evaluates to `true`.

    @property displayTemplate
    @type Function
    @default null
  */
  displayTemplate: null,

  /**
    The template to render when `shouldDisplayFunc` evaluates to `false`.

    @property inverseTemplate
    @type Function
    @default null
  */
  inverseTemplate: null,

  normalizedValue: function() {
    var result = this.lazyValue.value(),
        valueNormalizer = get(this, 'valueNormalizerFunc'),
        templateData;

    return valueNormalizer ? valueNormalizer(result) : result;
  },

  rerenderIfNeeded: function() {
    this.currentState.rerenderIfNeeded(this);
  },

  /**
    Determines which template to invoke, sets up the correct state based on
    that logic, then invokes the default `Ember.View` `render` implementation.

    This method will first look up the `path` key on `pathRoot`,
    then pass that value to the `shouldDisplayFunc` function. If that returns
    `true,` the `displayTemplate` function will be rendered to DOM. Otherwise,
    `inverseTemplate`, if specified, will be rendered.

    For example, if this `Ember._HandlebarsBoundView` represented the `{{#with
    foo}}` helper, it would look up the `foo` property of its context, and
    `shouldDisplayFunc` would always return true. The object found by looking
    up `foo` would be passed to `displayTemplate`.

    @method render
    @param {Ember.RenderBuffer} buffer
  */
  render: function(buffer) {
    // If not invoked via a triple-mustache ({{{foo}}}), escape
    // the content of the template.
    var escape = get(this, 'isEscaped');

    var shouldDisplay = get(this, 'shouldDisplayFunc'),
        preserveContext = get(this, 'preserveContext'),
        context = this.parentContext;

    var inverseTemplate = get(this, 'inverseTemplate'),
        displayTemplate = get(this, 'displayTemplate'),
        emptyTemplate = function() {
          return document.createTextNode(''); // TODO: is this how we should handle no-ops?
        };

    var result = this.normalizedValue();
    this._lastNormalizedValue = result;

    // First, test the conditional to see if we should
    // render the template or not.
    if (shouldDisplay(result)) {
      set(this, 'template', displayTemplate || emptyTemplate);

      // If we are preserving the context (for example, if this
      // is an #if block, call the template with the same object.
      if (preserveContext) {
        set(this, '_context', context);
      } else {
      // Otherwise, determine if this is a block bind or not.
      // If so, pass the specified object to the template
        if (displayTemplate) {
          set(this, '_context', result);
        } else {
        // This is not a bind block, just push the result of the
        // expression to the render context and return.
          if (result === null || result === undefined) {
            result = "";
          } else if (!(result instanceof SafeString)) {
            result = String(result);
          }

          if (escape) { result = Handlebars.Utils.escapeExpression(result); }
          buffer.push(result);
          return;
        }
      }
    } else if (inverseTemplate) {
      set(this, 'template', inverseTemplate);

      if (preserveContext) {
        set(this, '_context', context);
      } else {
        set(this, '_context', result);
      }
    } else {
      set(this, 'template', emptyTemplate);
    }

    return this._super(buffer);
  }
});

export {
  _HtmlbarsBoundView,
  SimpleHtmlbarsView
};