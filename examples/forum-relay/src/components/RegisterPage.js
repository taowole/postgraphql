import React from 'react'
import Relay from 'react-relay'
import { withRouter } from 'react-router'
import { RegisterPersonMutation } from '../mutations'
import RegisterForm from './RegisterForm'

class RegisterPage extends React.Component {
  static contextTypes = {
    auth: React.PropTypes.object,
  }

  onSubmit = (data) => {
    this.props.relay.commitUpdate(new RegisterPersonMutation({
      viewer: this.props.viewer,
      person: data,
    }), {
      onFailure: this.onFailure,
      onSuccess: this.onSuccess.bind(this, data),
    })
  }

  onFailure = (transaction) => {
    console.error(transaction)
  }

  onSuccess = (data) => {
    this.context.auth.handleLogin({
      email: data.email,
      password: data.password,
    }).then(() => this.props.router.push('/posts'))
  }

  render() {
    return <RegisterForm onSubmit={this.onSubmit} />
  }
}

export default Relay.createContainer(withRouter(RegisterPage), {
  fragments: {
    viewer: () => Relay.QL`
      fragment on Viewer {
        ${RegisterPersonMutation.getFragment('viewer')},
      }
    `,
  },
})
