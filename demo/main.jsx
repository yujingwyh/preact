import {Component, createContext, render,h} from '../src'


function Child() {
    var xx = e;
    return <div key={'child-div'}>234</div>
}
class Root extends Component{
    state = {
        hasError:false
    }
    componentDidCatch(e){

    }
    render(){
        if(this.state.hasError){
            return 'error'
        }
        return this.props.children
    }
}

render(<Root key={'root'}>
    <Child key={'child'}/>
</Root>, document.getElementById('app'));
