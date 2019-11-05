import { EMPTY_OBJ, EMPTY_ARR } from '../constants';
import { Component } from '../component';
import { Fragment } from '../create-element';
import { diffChildren, toChildArray } from './children';
import { diffProps } from './props';
import { assign, removeNode } from '../util';
import options from '../options';

/**
 * Diff two virtual nodes and apply proper changes to the DOM
 * @param {import('../internal').PreactElement} parentDom The parent of the DOM element
 * @param {import('../internal').VNode} newVNode The new virtual node
 * @param {import('../internal').VNode} oldVNode The old virtual node
 * @param {object} context The current context object
 * @param {boolean} isSvg Whether or not this element is an SVG node
 * @param {Array<import('../internal').PreactElement>} excessDomChildren
 * @param {Array<import('../internal').Component>} commitQueue List of components
 * which have callbacks to invoke in commitRoot
 * @param {Element | Text} oldDom The current attached DOM
 * element any new dom elements should be placed around. Likely `null` on first
 * render (except when hydrating). Can be a sibling DOM element when diffing
 * Fragments that have siblings. In most cases, it starts out as `oldChildren[0]._dom`.
 * @param {boolean} [isHydrating] Whether or not we are in hydration
 */
//对比虚拟节点
export function diff(
	parentDom,
	newVNode,
	oldVNode,
	context,
	isSvg,
	excessDomChildren,
	commitQueue,
	oldDom,
	isHydrating
) {
	let tmp,
		newType = newVNode.type;

	// When passing through createElement it assigns the object
	// constructor as undefined. This to prevent JSON-injection.
	//非虚拟节点直接返回
	if (newVNode.constructor !== undefined) return null;
	//diff钩子
	if ((tmp = options._diff)) tmp(newVNode);

	try {
		//如果是类组件或者函数组件
		outer: if (typeof newType === 'function') {
			let c, isNew, oldProps, oldState, snapshot, clearProcessingException;
			let newProps = newVNode.props;

			// Necessary for createContext api. Setting this property will pass
			// the context value as `this.context` just for this component.
			tmp = newType.contextType;
			//找到上层provider
			let provider = tmp && context[tmp._id];
			//有tmp时，提供provider时为provider的value，不然为createContext的defaultValue
			//没有是为上层的context
			let cctx = tmp
				? provider
					? provider.props.value
					: tmp._defaultValue
				: context;
			// Get component and set it to `c`
			//如果已经存在实例化的组件
			if (oldVNode._component) {
				c = newVNode._component = oldVNode._component;
				clearProcessingException = c._processingException = c._pendingError;
			} else {
				// Instantiate the new component
				if ('prototype' in newType && newType.prototype.render) {
					//类组件的话  去实例化
					newVNode._component = c = new newType(newProps, cctx); // eslint-disable-line new-cap
				} else {
					//函数组件的话实例化 Component
					newVNode._component = c = new Component(newProps, cctx);
					c.constructor = newType;
					//设置render
					c.render = doRender;
				}
				//订阅，当provider value改变时，渲染组件
				if (provider) provider.sub(c);

				c.props = newProps;
				if (!c.state) c.state = {};
				c.context = cctx;
				//至于还要用c._context不用c.context
				//由于context有可能为provider的value
				c._context = context;
				//标记需要渲染并且是新创建的组件
				isNew = c._dirty = true;
				c._renderCallbacks = [];
			}

			// Invoke getDerivedStateFromProps
			//如果nextState为假则赋值state
			if (c._nextState == null) {
				c._nextState = c.state;
			}
			//有getDerivedStateFromProps执行此生命周期并扩展到_nextState
			//如果nextState和state相同则拷贝nextState到nextState
			if (newType.getDerivedStateFromProps != null) {
				if (c._nextState == c.state) {
					c._nextState = assign({}, c._nextState);
				}

				assign(
					c._nextState,
					newType.getDerivedStateFromProps(newProps, c._nextState)
				);
			}

			oldProps = c.props;
			oldState = c.state;

			// Invoke pre-render lifecycle methods
			//如果是新创建的组件
			if (isNew) {
                //没有设置getDerivedStateFromProps但设置了componentWillMount则执行componentWillMount生命周期
                if (
					newType.getDerivedStateFromProps == null &&
					c.componentWillMount != null
				) {
					c.componentWillMount();
				}
				//如果有componentDidMount则放到_renderCallbacks
				if (c.componentDidMount != null) {
					c._renderCallbacks.push(c.componentDidMount);
				}
			} else {
				//没有设置getDerivedStateFromProps并且不是forceUpdate并且设置了componentWillReceiveProps则执行此生命周期
				if (
					newType.getDerivedStateFromProps == null &&
					c._force == null &&
					c.componentWillReceiveProps != null
				) {
					c.componentWillReceiveProps(newProps, cctx);
				}
				//如果不是forceUpdate并且shouldComponentUpdate则执行次生命周期返回false的情况下
				if (
					!c._force &&
					c.shouldComponentUpdate != null &&
					c.shouldComponentUpdate(newProps, c._nextState, cctx) === false
				) {
					c.props = newProps;
					c.state = c._nextState;
					//标记已渲染
					c._dirty = false;
					c._vnode = newVNode;
					//dom还是老虚拟节点的dom
					newVNode._dom = oldVNode._dom;
					newVNode._children = oldVNode._children;
					if (c._renderCallbacks.length) {
						commitQueue.push(c);
					}
					for (tmp = 0; tmp < newVNode._children.length; tmp++) {
						if (newVNode._children[tmp]) {
							newVNode._children[tmp]._parent = newVNode;
						}
					}
					//跳出outer
					break outer;
				}
				//如果设置了componentWillUpdate则执行此生命周期
				if (c.componentWillUpdate != null) {
					c.componentWillUpdate(newProps, c._nextState, cctx);
				}
				//如果componentDidUpdate不为空则放到_renderCallbacks中
				if (c.componentDidUpdate != null) {
					c._renderCallbacks.push(() => {
						c.componentDidUpdate(oldProps, oldState, snapshot);
					});
				}
			}

			c.context = cctx;
			c.props = newProps;
			c.state = c._nextState;
			//render钩子
			if ((tmp = options._render)) tmp(newVNode);
			//标记已渲染
			c._dirty = false;
			c._vnode = newVNode;
			c._parentDom = parentDom;
			//执行render
			tmp = c.render(c.props, c.state, c.context);
			//如果render返回结果中最外层是Fragment组件
			let isTopLevelFragment =
				tmp != null && tmp.type == Fragment && tmp.key == null;
			//片段组件则使用props.children，其它使用render返回的
			newVNode._children = toChildArray(
				isTopLevelFragment ? tmp.props.children : tmp
			);
			//如果是Provider组件，然后调用getChildContext
			if (c.getChildContext != null) {
				context = assign(assign({}, context), c.getChildContext());
			}
			//执行getSnapshotBeforeUpdate生命周期，他是静态函数
			if (!isNew && c.getSnapshotBeforeUpdate != null) {
				snapshot = c.getSnapshotBeforeUpdate(oldProps, oldState);
			}
			//对比子节点
			diffChildren(
				parentDom,
				newVNode,
				oldVNode,
				context,
				isSvg,
				excessDomChildren,
				commitQueue,
				oldDom,
				isHydrating
			);

			c.base = newVNode._dom;
			//有renderCallback则放到commitQueue中，所有渲染完成一起执行
			if (c._renderCallbacks.length) {
				commitQueue.push(c);
			}
			//清除error
			if (clearProcessingException) {
				c._pendingError = c._processingException = null;
			}
			//设置强制更新为false
			c._force = null;
		} else {
			//其它类型调用diffElementNodes去比较
			newVNode._dom = diffElementNodes(
				oldVNode._dom,
				newVNode,
				oldVNode,
				context,
				isSvg,
				excessDomChildren,
				commitQueue,
				isHydrating
			);
		}
		//diffed钩子
		if ((tmp = options.diffed)) tmp(newVNode);
	} catch (e) {
		//触发错误
		options._catchError(e, newVNode, oldVNode);
	}

	return newVNode._dom;
}
//执行did生命周期和setState的回调
/**
 * @param {Array<import('../internal').Component>} commitQueue List of components
 * which have callbacks to invoke in commitRoot
 * @param {import('../internal').VNode} root
 */
export function commitRoot(commitQueue, root) {
	if (options._commit) options._commit(root, commitQueue);

	commitQueue.some(c => {
		try {
			//拷贝一份回调，防止执行时在加入回调形成死循环
			commitQueue = c._renderCallbacks;
			c._renderCallbacks = [];
			//循环执行
			commitQueue.some(cb => {
				cb.call(c);
			});
		} catch (e) {
			options._catchError(e, c._vnode);
		}
	});
}

/**
 * Diff two virtual nodes representing DOM element
 * @param {import('../internal').PreactElement} dom The DOM element representing
 * the virtual nodes being diffed
 * @param {import('../internal').VNode} newVNode The new virtual node
 * @param {import('../internal').VNode} oldVNode The old virtual node
 * @param {object} context The current context object
 * @param {boolean} isSvg Whether or not this DOM node is an SVG node
 * @param {*} excessDomChildren
 * @param {Array<import('../internal').Component>} commitQueue List of components
 * which have callbacks to invoke in commitRoot
 * @param {boolean} isHydrating Whether or not we are in hydration
 * @returns {import('../internal').PreactElement}
 */
function diffElementNodes(
	dom,
	newVNode,
	oldVNode,
	context,
	isSvg,
	excessDomChildren,
	commitQueue,
	isHydrating
) {
	let i;
	let oldProps = oldVNode.props;
	let newProps = newVNode.props;

	// Tracks entering and exiting SVG namespace when descending through the tree.
	//判断是否是svg
	isSvg = newVNode.type === 'svg' || isSvg;
	//判断能否复用excessDomChildren中的dom
	if (dom == null && excessDomChildren != null) {
		for (i = 0; i < excessDomChildren.length; i++) {
			const child = excessDomChildren[i];
			//如果虚拟节点类型为null而存在节点类型是text或者虚拟节点类型和存在节点类型相同，则复用
			if (
				child != null &&
				(newVNode.type === null
					? child.nodeType === 3
					: child.localName === newVNode.type)
			) {
				dom = child;
				//设置对应的存在节点为空
				excessDomChildren[i] = null;
				break;
			}
		}
	}
	//以上excessDomChildren中的元素和newNode是同一级的
	//下面excessDomChildren中的元素是newNode的下级
	//如果dom为空
	if (dom == null) {
		//text节点
		if (newVNode.type === null) {
			return document.createTextNode(newProps);
		}
		//创建元素
		dom = isSvg
			? document.createElementNS('http://www.w3.org/2000/svg', newVNode.type)
			: document.createElement(newVNode.type);
		// we created a new parent, so none of the previously attached children can be reused:
		//已经新创建了dom，excessDomChildren为空
		excessDomChildren = null;
	}
	//如果是text节点
	if (newVNode.type === null) {
		if (excessDomChildren != null) {
			excessDomChildren[excessDomChildren.indexOf(dom)] = null;
		}
		if (oldProps !== newProps) {
			dom.data = newProps;
		}
	} //新老节点不相等
	else if (newVNode!==oldVNode) {
		if (excessDomChildren!=null) {
			excessDomChildren = EMPTY_ARR.slice.call(dom.childNodes);
		}

		oldProps = oldVNode.props || EMPTY_OBJ;

		let oldHtml = oldProps.dangerouslySetInnerHTML;
		let newHtml = newProps.dangerouslySetInnerHTML;

		// During hydration, props are not diffed at all (including dangerouslySetInnerHTML)
		// @TODO we should warn in debug mode when props don't match here.
		if (!isHydrating) {
			if (oldProps === EMPTY_OBJ) {
				oldProps = {};
				for (let i = 0; i < dom.attributes.length; i++) {
					oldProps[dom.attributes[i].name] = dom.attributes[i].value;
				}
			}

			if (newHtml || oldHtml) {
				// Avoid re-applying the same '__html' if it did not changed between re-render
				if (!newHtml || !oldHtml || newHtml.__html != oldHtml.__html) {
					dom.innerHTML = (newHtml && newHtml.__html) || '';
				}
			}
		}
		//对比元素的属性
		diffProps(dom, newProps, oldProps, isSvg, isHydrating);
		//设置_children
		newVNode._children = newVNode.props.children;

		// If the new vnode didn't have dangerouslySetInnerHTML, diff its children
		if (!newHtml) {
			diffChildren(
				dom,
				newVNode,
				oldVNode,
				context,
				newVNode.type === 'foreignObject' ? false : isSvg,
				excessDomChildren,
				commitQueue,
				EMPTY_OBJ,
				isHydrating
			);
		}

		// (as above, don't diff props during hydration)
		if (!isHydrating) {
			if (
				'value' in newProps &&
				newProps.value !== undefined &&
				newProps.value !== dom.value
			) {
				dom.value = newProps.value == null ? '' : newProps.value;
			}
			if (
				'checked' in newProps &&
				newProps.checked !== undefined &&
				newProps.checked !== dom.checked
			) {
				dom.checked = newProps.checked;
			}
		}
	}

	return dom;
}

/**
 * Invoke or update a ref, depending on whether it is a function or object ref.
 * @param {object|function} ref
 * @param {any} value
 * @param {import('../internal').VNode} vnode
 */
//应用ref
export function applyRef(ref, value, vnode) {
	try {
		//如果是函数 执行函数并把ref传进去
		if (typeof ref == 'function') ref(value);
		//其它赋值给current属性
		else ref.current = value;
	}
	//捕获错误
	catch (e) {
		options._catchError(e, vnode);
	}
}

/**
 * Unmount a virtual node from the tree and apply DOM changes
 * @param {import('../internal').VNode} vnode The virtual node to unmount
 * @param {import('../internal').VNode} parentVNode The parent of the VNode that
 * initiated the unmount
 * @param {boolean} [skipRemove] Flag that indicates that a parent node of the
 * current element is already detached from the DOM.
 */
//卸载虚拟节点
export function unmount(vnode, parentVNode, skipRemove) {
	let r;
	//unmount钩子
	if (options.unmount) options.unmount(vnode);
	//如果有ref则将ref设置为null
	if ((r = vnode.ref)) {
		applyRef(r, null, parentVNode);
	}

	let dom;
	//如果虚拟节点不是函数并且skipRemove为false 则赋值到dom方便后面移除节点
	//skipRemove的作用是在后面循环子节点unmount时不会执行removeNode
	if (!skipRemove && typeof vnode.type !== 'function') {
		skipRemove = (dom = vnode._dom) != null;
	}
	//dom设置为空
	vnode._dom = vnode._lastDomChild = null;

	if ((r = vnode._component) != null) {
		//执行组件生命周期
		if (r.componentWillUnmount) {
			try {
				r.componentWillUnmount();
			} catch (e) {
				options._catchError(e, parentVNode);
			}
		}

		r.base = r._parentDom = null;
	}
	//循环卸载子节点
	if ((r = vnode._children)) {
		for (let i = 0; i < r.length; i++) {
			if (r[i]) unmount(r[i], parentVNode, skipRemove);
		}
	}
	//dom不为空则移除dom
	if (dom != null) removeNode(dom);
}

/** The `.render()` method for a PFC backing instance. */
//函数组件的render
function doRender(props, state, context) {
	//就是执行这个函数组件
	return this.constructor(props, context);
}
