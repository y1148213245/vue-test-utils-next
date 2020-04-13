import {
  h,
  createApp,
  VNode,
  defineComponent,
  VNodeNormalizedChildren,
  ComponentOptions,
  transformVNodeArgs,
  Plugin,
  Directive,
  Component,
  reactive
} from 'vue'

import { createWrapper } from './vue-wrapper'
import { createEmitMixin } from './emitMixin'
import { createDataMixin } from './dataMixin'
import { MOUNT_ELEMENT_ID } from './constants'
import { createStub } from './stub'

type Slot = VNode | string | { render: Function }

interface MountingOptions {
  data?: () => Record<string, unknown>
  props?: Record<string, any>
  slots?: {
    default?: Slot
    [key: string]: Slot
  }
  global?: {
    plugins?: Plugin[]
    mixins?: ComponentOptions[]
    mocks?: Record<string, any>
    stubs?: Record<any, any>
    provide?: Record<any, any>
    // TODO how to type `defineComponent`? Using `any` for now.
    components?: Record<string, Component | object>
    directives?: Record<string, Directive>
  }
  stubs?: Record<string, any>
}

export function mount(originalComponent: any, options?: MountingOptions) {
  const component = { ...originalComponent }

  // Reset the document.body
  document.getElementsByTagName('html')[0].innerHTML = ''
  const el = document.createElement('div')
  el.id = MOUNT_ELEMENT_ID
  document.body.appendChild(el)

  // handle any slots passed via mounting options
  const slots: VNodeNormalizedChildren =
    options?.slots &&
    Object.entries(options.slots).reduce((acc, [name, slot]) => {
      // case of an SFC getting passed
      if (typeof slot === 'object' && 'render' in slot) {
        acc[name] = slot.render
        return acc
      }

      acc[name] = () => slot
      return acc
    }, {})

  // override component data with mounting options data
  if (options?.data) {
    const dataMixin = createDataMixin(options.data())
    component.mixins = [...(component.mixins || []), dataMixin]
  }

  // we define props as reactive so that way when we update them with `setProps`
  // Vue's reactivity system will cause a rerender.
  const props = reactive({ ...options?.props, ref: 'VTU_COMPONENT' })

  // create the wrapper component
  const Parent = defineComponent({
    name: 'VTU_COMPONENT',
    render() {
      return h(component, props, slots)
    }
  })

  const setProps = (newProps: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(newProps)) {
      props[k] = v
    }

    return app.$nextTick()
  }

  // create the vm
  const vm = createApp(Parent)

  // global mocks mixin
  if (options?.global?.mocks) {
    const mixin = {
      beforeCreate() {
        for (const [k, v] of Object.entries(options.global?.mocks)) {
          this[k] = v
        }
      }
    }

    vm.mixin(mixin)
  }

  // use and plugins from mounting options
  if (options?.global?.plugins) {
    for (const use of options?.global?.plugins) vm.use(use)
  }

  // use any mixins from mounting options
  if (options?.global?.mixins) {
    for (const mixin of options?.global?.mixins) vm.mixin(mixin)
  }

  if (options?.global?.components) {
    for (const key of Object.keys(options?.global?.components))
      vm.component(key, options.global.components[key])
  }

  if (options?.global?.directives) {
    for (const key of Object.keys(options?.global?.directives))
      vm.directive(key, options.global.directives[key])
  }

  // provide any values passed via provides mounting option
  if (options?.global?.provide) {
    for (const key of Reflect.ownKeys(options.global.provide)) {
      // @ts-ignore: https://github.com/microsoft/TypeScript/issues/1863
      vm.provide(key, options.global.provide[key])
    }
  }

  // add tracking for emitted events
  const { emitMixin, events } = createEmitMixin()
  vm.mixin(emitMixin)

  transformVNodeArgs((args, instance) => {
    // regular HTML Element. Do not stubs these
    if (Array.isArray(args) && typeof args[0] === 'string') {
      return args
    }

    // don't care about comments/fragments
    if (typeof args[0] === 'symbol') {
      return args
    }

    // do not stub the VTU Parent component
    if (typeof args[0] === 'object' && args[0]['name'] === 'VTU_COMPONENT') {
      return args
    }

    if (
      typeof args[0] === 'object' &&
      args[0]['name'] in options?.global?.stubs
    ) {
      const name = args[0]['name']
      // default stub
      if (options?.global?.stubs[name] === true) {
        return [createStub({ name: args[0]['name'] })]
      }

      // custom stub implementation
      if (typeof options?.global?.stubs[name] === 'object') {
        return [options?.global?.stubs[name]]
      }
    }

    return args
  })

  // mount the app!
  const app = vm.mount(el)

  return createWrapper(app, events, setProps)
}
